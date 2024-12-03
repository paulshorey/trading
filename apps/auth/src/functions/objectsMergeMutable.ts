function isObject(item: any) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

export default function objectsMergeMutable(
  target: Record<string, any>,
  source: Record<string, any>
): void {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        objectsMergeMutable(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
}
