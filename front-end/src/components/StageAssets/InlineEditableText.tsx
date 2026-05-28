import React, { useEffect, useState } from 'react';

interface InlineEditableTextProps {
  value: string;
  onSave: (nextValue: string) => void;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  inputClassName: string;
  renderDisplay: (value: string, startEdit: () => void) => React.ReactNode;
}

const InlineEditableText: React.FC<InlineEditableTextProps> = ({
  value,
  onSave,
  required = true,
  multiline = false,
  rows = 2,
  inputClassName,
  renderDisplay,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    if (!isEditing) {
      setDraft(value || '');
    }
  }, [value, isEditing]);

  const commit = () => {
    const next = draft.trim();
    if (required && !next) {
      setDraft(value || '');
      setIsEditing(false);
      return;
    }
    onSave(next);
    setIsEditing(false);
  };

  const startEdit = () => {
    setDraft(value || '');
    setIsEditing(true);
  };

  if (!isEditing) {
    return <>{renderDisplay(value, startEdit)}</>;
  }

  if (multiline) {
    return (
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        rows={rows}
        autoFocus
        className={inputClassName}
      />
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        } else if (event.key === 'Escape') {
          setDraft(value || '');
          setIsEditing(false);
        }
      }}
      autoFocus
      className={inputClassName}
    />
  );
};

export default InlineEditableText;
