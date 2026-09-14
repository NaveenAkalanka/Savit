import { useState } from 'react';
import type { Link } from '@savit/shared';
import { Check, X } from '@phosphor-icons/react';
import { api } from '../api.ts';

interface SaveDialogProps {
  link?: Link; // present -> edit mode; absent -> create mode
  initialUrl?: string;
  initialTitle?: string;
  initialImage?: string;
  categories: string[];
  onDone: (link: Link) => void;
  onClose: () => void;
}

export function SaveDialog({ link, initialUrl, initialTitle, initialImage, categories, onDone, onClose }: SaveDialogProps) {
  const isEdit = Boolean(link);
  const [url, setUrl] = useState(link?.url ?? initialUrl ?? '');
  const [title, setTitle] = useState(link?.title ?? initialTitle ?? '');
  const [note, setNote] = useState(link?.note ?? '');
  const [category, setCategory] = useState(link?.category ?? '');
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const image = link?.imageUrl ?? initialImage ?? '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const finalCategory = newCategory.trim() || category;
      if (isEdit && link) {
        const updated = await api.update(link.id, { title, note, category: finalCategory });
        onDone(updated);
      } else {
        const created = await api.create({
          url,
          title,
          note,
          category: finalCategory,
          imageUrl: image || null,
          imageSource: image ? 'auto' : 'none',
        });
        onDone(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} title="Close" aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
        <h2>{isEdit ? 'Edit link' : 'Save link'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Link</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              readOnly={isEdit}
              disabled={isEdit}
              required={!isEdit}
              placeholder="https://example.com"
            />
          </div>
          <div className="field">
            <label>Name</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Or new category</label>
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. reading" />
          </div>
          {error && <div style={{ color: 'var(--label)', fontSize: 12 }}>{error}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              <X size={14} aria-hidden="true" />
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              <Check size={14} weight="bold" aria-hidden="true" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
