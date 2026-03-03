import { Button } from '@mantine/core';

export function CreateHuntFromSearch({
  savedSearchId,
}: {
  savedSearchId?: string | null;
}) {
  const handleCreateHuntFromSearch = () => {
    console.warn('Implement CreateHuntFromSearch: ', savedSearchId);
  };

  return (
    <Button
      data-testid="create-hunt-from-search-button"
      variant="secondary"
      size="xs"
      onClick={handleCreateHuntFromSearch}
      style={{ flexShrink: 0 }}
    >
      Create Hunt
    </Button>
  );
}
