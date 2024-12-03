export default function deepMerge(
  obj1: Record<string, any>,
  obj2: Record<string, any>
): Record<string, any> {
  let result = { ...obj1 };
  for (let key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      if (typeof obj2[key] === 'object' && obj2[key] !== null && obj1[key]) {
        result[key] = deepMerge(obj1[key], obj2[key]);
      } else {
        result[key] = obj2[key];
      }
    }
  }
  return result;
}
