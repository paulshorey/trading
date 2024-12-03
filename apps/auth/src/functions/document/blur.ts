export function blur() {
  try {
    // @ts-ignore
    document.activeElement?.blur();
  } catch (error) {
    //
  }
}
