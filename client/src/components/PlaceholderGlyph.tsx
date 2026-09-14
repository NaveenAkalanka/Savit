import { Image } from '@phosphor-icons/react';

export function PlaceholderGlyph({ className }: { className?: string }) {
  return <Image className={className} weight="thin" aria-hidden="true" />;
}
