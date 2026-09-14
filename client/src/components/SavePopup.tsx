import type { SaveInitialData } from '../types.ts';
import { SaveDialog } from './SaveDialog.tsx';

export function SavePopup({ initialData }: { initialData: SaveInitialData }) {
  return (
    <div className="save-popup">
      <SaveDialog
        initialUrl={initialData.url}
        initialTitle={initialData.title}
        initialImage={initialData.image}
        categories={initialData.categories}
        onDone={() => window.close()}
        onClose={() => window.close()}
      />
    </div>
  );
}
