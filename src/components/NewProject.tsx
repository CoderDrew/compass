import { Plus } from 'lucide-react';
import { useState } from 'react';
import { CATEGORIES, PRIORITIES, STATUSES } from '../data/meta';
import type { CategoryId, Priority, Status } from '../data/types';
import { addProject, newProject } from '../lib/ops';
import { navigate } from '../state/router';
import { useStore } from '../state/store';
import { Button, Modal } from './ui';

/** Minimal create flow: only a name is required. Everything else can be filled in later. */
export function NewProjectButton({ defaultCategory = 'business', label = 'New project' }: { defaultCategory?: CategoryId; label?: string }) {
  const { apply } = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CategoryId>(defaultCategory);
  const [status, setStatus] = useState<Status>('active');
  const [priority, setPriority] = useState<Priority>('medium');
  const [nextAction, setNextAction] = useState('');

  const submit = () => {
    if (!name.trim()) return;
    const p = newProject({ name: name.trim(), category, status, priority, nextAction: nextAction.trim() });
    apply((d) => addProject(d, p), { toast: 'Project created' });
    setOpen(false);
    setName('');
    setNextAction('');
    navigate('project', p.id);
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} onClick={submit}>
              Create
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label className="label" htmlFor="np-name">
              Name
            </label>
            <input id="np-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="What is it?" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label" htmlFor="np-cat">
                Category
              </label>
              <select id="np-cat" className="field" value={category} onChange={(e) => setCategory(e.target.value as CategoryId)}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.short}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="np-status">
                Status
              </label>
              <select id="np-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="np-pri">
                Priority
              </label>
              <select id="np-pri" className="field" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="np-next">
              Next action <span className="text-faint">(optional)</span>
            </label>
            <input id="np-next" className="field" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="The very next physical step" />
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>
    </>
  );
}
