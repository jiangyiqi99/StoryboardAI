export interface StoryboardAssociation {
  storyboardRef: string;
  segmentId: string;
  segmentIndex: number;
  segmentNumber: number;
  paddedSegmentNumber: string;
  assetId: string;
  clipId: string;
  jobIdPrefix: string;
}

export const createStoryboardAssociation = (
  segmentId: string,
  segmentIndex: number
): StoryboardAssociation => {
  const normalizedIndex = Number.isFinite(segmentIndex)
    ? Math.max(0, Math.floor(segmentIndex))
    : 0;
  const segmentNumber = normalizedIndex + 1;
  const paddedSegmentNumber = String(segmentNumber).padStart(2, "0");
  const safeSegmentId = sanitizeAssociationPart(segmentId);
  const storyboardRef = `storyboard-${paddedSegmentNumber}-${safeSegmentId}`;

  return {
    storyboardRef,
    segmentId,
    segmentIndex: normalizedIndex,
    segmentNumber,
    paddedSegmentNumber,
    assetId: `asset-${storyboardRef}`,
    clipId: `clip-${storyboardRef}`,
    jobIdPrefix: `job-${storyboardRef}`
  };
};

export const createStoryboardAssociationMetadata = (
  association: StoryboardAssociation
): Record<string, string | number> => ({
  storyboardRef: association.storyboardRef,
  storySegmentId: association.segmentId,
  storySegmentIndex: association.segmentIndex,
  storySegmentNumber: association.segmentNumber,
  storyboardNumber: association.segmentNumber,
  storyboardAssetId: association.assetId,
  storyboardClipId: association.clipId,
  storyboardJobIdPrefix: association.jobIdPrefix
});

export const createStoryboardAssociationTags = (
  association: StoryboardAssociation
): string[] => [
  `storyboard-ref:${association.storyboardRef}`,
  `story-segment:${association.segmentId}`,
  `story-index:${association.segmentIndex}`,
  `story-number:${association.segmentNumber}`
];

const sanitizeAssociationPart = (value: string): string => {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "segment";
};
