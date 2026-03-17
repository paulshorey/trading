import fs from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const repoRoot = path.resolve(appRoot, "../..");
const contractPath = path.resolve(
  repoRoot,
  "lib/db-marketing/generated/contracts/notes-app.json",
);
const modelsPath = path.resolve(
  appRoot,
  "app/src/main/java/com/eighthbrain/notesandroid/app/model/Models.kt",
);
const jsonCodecPath = path.resolve(
  appRoot,
  "app/src/main/java/com/eighthbrain/notesandroid/app/data/JsonCodec.kt",
);
const apiClientPath = path.resolve(
  appRoot,
  "app/src/main/java/com/eighthbrain/notesandroid/app/data/NotesApiClient.kt",
);

const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
const modelsContent = await fs.readFile(modelsPath, "utf8");
const jsonCodecContent = await fs.readFile(jsonCodecPath, "utf8");
const apiClientContent = await fs.readFile(apiClientPath, "utf8");

const requiredModels = ["UserSummary", "NoteRecord", "SemanticSearchResult"];
const jsonCodecBindings = [
  { functionName: "userFromJson", modelName: "UserSummary" },
  { functionName: "noteFromJson", modelName: "NoteRecord" },
  { functionName: "searchResultFromJson", modelName: "SemanticSearchResult" },
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const readModel = (modelName) => {
  const model = contract.models[modelName];

  if (!model) {
    throw new Error(`Missing model in notes-app contract: ${modelName}`);
  }

  return model;
};

const parseDataClasses = (content) => {
  const dataClasses = new Map();
  const regex = /data class\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\n\)/g;

  for (const match of content.matchAll(regex)) {
    const [, className, body] = match;
    const fields = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("val "))
      .map((line) => {
        const fieldMatch = line.match(/^val\s+([A-Za-z0-9_]+):\s*([^,\n]+),?$/);

        if (!fieldMatch) {
          throw new Error(`Unsupported Kotlin field definition: ${line}`);
        }

        return {
          name: fieldMatch[1],
          type: fieldMatch[2].trim(),
        };
      });

    dataClasses.set(className, fields);
  }

  return dataClasses;
};

const parseNamedAssignments = (content, functionName, modelName) => {
  const regex = new RegExp(
    `fun\\s+${functionName}\\s*\\([^)]*\\)\\s*(?::\\s*[^=]+)?=\\s*\\n\\s*${modelName}\\(([\\s\\S]*?)\\n\\s*\\)`,
    "m",
  );
  const match = content.match(regex);

  if (!match) {
    throw new Error(`Could not find ${functionName} for ${modelName} in JsonCodec.kt`);
  }

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const assignmentMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+),?$/);

      if (!assignmentMatch) {
        throw new Error(`Unsupported JsonCodec assignment: ${line}`);
      }

      return {
        name: assignmentMatch[1],
        expression: assignmentMatch[2].trim().replace(/,$/, ""),
      };
    });
};

const isIntegerLikeField = (fieldName) =>
  fieldName === "id" || fieldName.endsWith("Id") || fieldName === "limit";

const expectedKotlinTypes = (field) => {
  if (field.kind === "array") {
    const innerTypes = expectedKotlinTypes({
      ...field.items,
      name: field.name,
      nullable: false,
    });

    return innerTypes.map((innerType) => `List<${innerType}>`);
  }

  if (field.kind === "model") {
    return [field.nullable ? `${field.type}?` : field.type];
  }

  if (field.type === "string") {
    return [field.nullable ? "String?" : "String"];
  }

  if (field.type === "boolean" || field.type === "true" || field.type === "false") {
    return [field.nullable ? "Boolean?" : "Boolean"];
  }

  if (field.type === "number") {
    const baseTypes = isIntegerLikeField(field.name)
      ? ["Int", "Long"]
      : ["Double", "Float", "Int", "Long"];
    return baseTypes.map((baseType) => (field.nullable ? `${baseType}?` : baseType));
  }

  return [field.nullable ? "Any?" : "Any"];
};

const expectedCodecPattern = (field) => {
  const fieldName = escapeRegExp(field.name);

  if (field.kind === "model") {
    return new RegExp(
      `^[A-Za-z0-9_]+FromJson\\(json\\.getJSONObject\\("${fieldName}"\\)\\)$`,
    );
  }

  if (field.kind === "array") {
    return /.*/;
  }

  if (field.type === "string") {
    return field.nullable
      ? new RegExp(`^json\\.stringOrNull\\("${fieldName}"\\)$`)
      : new RegExp(`^json\\.getString\\("${fieldName}"\\)$`);
  }

  if (field.type === "number") {
    if (field.nullable) {
      return new RegExp(`^json\\.doubleOrNull\\("${fieldName}"\\)$`);
    }

    if (isIntegerLikeField(field.name)) {
      return new RegExp(`^json\\.get(?:Int|Long)\\("${fieldName}"\\)$`);
    }

    return new RegExp(`^json\\.get(?:Double|Int|Long)\\("${fieldName}"\\)$`);
  }

  if (field.type === "boolean" || field.type === "true" || field.type === "false") {
    return field.nullable
      ? new RegExp(`^json\\.optBoolean\\("${fieldName}"\\)$`)
      : new RegExp(`^json\\.getBoolean\\("${fieldName}"\\)$`);
  }

  return /.*/;
};

const dataClasses = parseDataClasses(modelsContent);

for (const modelName of requiredModels) {
  const expectedFields = readModel(modelName).fields;
  const actualFields = dataClasses.get(modelName);

  if (!actualFields) {
    throw new Error(`Missing Kotlin data class for ${modelName}`);
  }

  if (actualFields.length !== expectedFields.length) {
    throw new Error(
      `${modelName} field count mismatch. Expected ${expectedFields.length}, found ${actualFields.length}.`,
    );
  }

  expectedFields.forEach((expectedField, index) => {
    const actualField = actualFields[index];

    if (!actualField || actualField.name !== expectedField.name) {
      throw new Error(
        `${modelName} field mismatch at position ${index + 1}. Expected ${expectedField.name}, found ${actualField?.name ?? "missing"}.`,
      );
    }

    const allowedTypes = expectedKotlinTypes(expectedField);

    if (!allowedTypes.includes(actualField.type)) {
      throw new Error(
        `${modelName}.${expectedField.name} should use one of [${allowedTypes.join(", ")}], found ${actualField.type}.`,
      );
    }
  });
}

for (const binding of jsonCodecBindings) {
  const expectedFields = readModel(binding.modelName).fields;
  const assignments = parseNamedAssignments(
    jsonCodecContent,
    binding.functionName,
    binding.modelName,
  );

  if (assignments.length !== expectedFields.length) {
    throw new Error(
      `${binding.functionName} field count mismatch. Expected ${expectedFields.length}, found ${assignments.length}.`,
    );
  }

  expectedFields.forEach((expectedField, index) => {
    const assignment = assignments[index];

    if (!assignment || assignment.name !== expectedField.name) {
      throw new Error(
        `${binding.functionName} field mismatch at position ${index + 1}. Expected ${expectedField.name}, found ${assignment?.name ?? "missing"}.`,
      );
    }

    const pattern = expectedCodecPattern(expectedField);

    if (!pattern.test(assignment.expression)) {
      throw new Error(
        `${binding.functionName}.${expectedField.name} does not match the notes-app contract. Found: ${assignment.expression}`,
      );
    }
  });
}

const requiredApiSnippets = [
  '.put("identifier", identifier.trim())',
  '.put("title", noteDraft.title)',
  '.put("summary", noteDraft.summary)',
  '.put("description", noteDraft.description)',
  '.put("timeDue", parseLocalInputToIso(noteDraft.dueInput, "Due time"))',
  '.put("timeRemind", parseLocalInputToIso(noteDraft.remindInput, "Reminder time"))',
  '.put("userId", userId)',
  '.put("note", noteJson)',
  '.put("noteId", noteId)',
  '.put("query", query.trim())',
  '.put("limit", limit)',
  'userFromJson(response.getJSONObject("user"))',
  'val notesArray = response.getJSONArray("notes")',
  'noteFromJson(response.getJSONObject("note"))',
  'val resultsArray = response.getJSONArray("results")',
];

for (const snippet of requiredApiSnippets) {
  if (!apiClientContent.includes(snippet)) {
    throw new Error(
      `NotesApiClient.kt is missing an expected notes-app contract reference: ${snippet}`,
    );
  }
}

console.log("notes-android contract validation passed");
