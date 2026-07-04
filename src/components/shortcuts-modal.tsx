"use client";

import { Modal } from "./ui";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Global",
    items: [
      ["⌘K", "Command palette"],
      ["⌘J", "AI chat"],
      ["C", "Compose"],
      ["/", "Focus search"],
      ["?", "Show this menu"],
    ],
  },
  {
    title: "Mail list",
    items: [
      ["J / K", "Move selection"],
      ["Enter / O", "Open conversation"],
      ["X", "Select row"],
      ["E", "Archive"],
      ["S", "Star"],
      ["U", "Toggle read / unread"],
      ["#", "Trash · delete forever in Trash"],
      ["Esc", "Clear selection / close thread"],
    ],
  },
  {
    title: "Composer",
    items: [["⌘Enter", "Send"]],
  },
];

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width={440}>
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-mut2">
              {g.title}
            </h3>
            <div className="space-y-1.5">
              {g.items.map(([key, label]) => (
                <div key={label} className="flex items-center justify-between text-[13px] text-mut">
                  <span>{label}</span>
                  <span className="kbd">{key}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
