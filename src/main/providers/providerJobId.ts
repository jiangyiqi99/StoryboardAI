export const encodeProviderJobId = (...parts: string[]): string => {
  return parts.map((part) => encodeURIComponent(part)).join("|");
};

export const decodeProviderJobId = (
  providerJobId: string,
  expectedParts: number
): string[] => {
  const parts = providerJobId.split("|").map((part) => decodeURIComponent(part));
  if (parts.length >= expectedParts) {
    return parts;
  }

  return providerJobId ? [providerJobId] : [];
};
