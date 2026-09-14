import { useEffect, useRef, useState } from 'react';
import { Trash, Warning } from '@phosphor-icons/react';

const ARM_TIMEOUT_MS = 3000;

export function DeleteConfirm({ onConfirm, label = 'DELETE' }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timeoutRef.current = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setArmed(false);
    onConfirm();
  }

  return (
    <button type="button" className={`delete-confirm${armed ? ' armed' : ''}`} onClick={handleClick}>
      {armed ? <Warning size={14} weight="fill" aria-hidden="true" /> : <Trash size={14} aria-hidden="true" />}
      {armed ? 'CONFIRM?' : label}
    </button>
  );
}
