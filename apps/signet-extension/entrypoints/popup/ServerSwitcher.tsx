import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { Check, ChevronDown, KeyRound, Plus } from 'lucide-react';
import { getActiveServerId, getServers, setActiveServer, type Server } from '../../src/lib/storage';

export function ServerSwitcher({ onSwitched }: { onSwitched: () => void | Promise<void> }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      setServers(await getServers());
      setActiveId(await getActiveServerId());
    })();
  }, []);

  const active = servers.find((s) => s.id === activeId) ?? servers[0];

  const select = async (id: string) => {
    setOpen(false);
    if (id === active?.id) return;
    await setActiveServer(id);
    setActiveId(id);
    await onSwitched();
  };

  const addServer = () => {
    setOpen(false);
    void browser.tabs.create({ url: browser.runtime.getURL('/setup.html') });
    window.close();
  };

  return (
    <span className="switcher">
      <span className="brand-mark">
        <KeyRound size={15} />
      </span>
      <button className="switcher-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="switcher-trigger-label">{active?.label ?? 'Signet'}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <>
          <span className="switcher-backdrop" onClick={() => setOpen(false)} />
          <div className="switcher-menu">
            {servers.map((s) => (
              <button
                key={s.id}
                className={`switcher-item ${s.id === active?.id ? 'active' : ''}`}
                onClick={() => select(s.id)}
              >
                <span className="switcher-item-label">{s.label}</span>
                {s.id === active?.id && <Check size={14} />}
              </button>
            ))}
            <button className="switcher-item add" onClick={addServer}>
              <Plus size={14} /> Add server
            </button>
          </div>
        </>
      )}
    </span>
  );
}
