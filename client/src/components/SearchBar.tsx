import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';

export function SearchBar({
  initialValue = '',
  onQueryChange,
}: {
  initialValue?: string;
  onQueryChange: (q: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onQueryChange(value), 250);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleClear() {
    setValue('');
    inputRef.current?.focus();
  }

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        id="global-search-input"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search title / url / note / category"
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          onClick={handleClear}
          title="Clear search"
          aria-label="Clear search"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
