export function tagLabel(tag: { name: string; name_en?: string | null }, language: string): string {
  if (language.toLowerCase().startsWith("zh")) {
    return tag.name;
  }
  const english = tag.name_en?.trim();
  return english || tag.name;
}
