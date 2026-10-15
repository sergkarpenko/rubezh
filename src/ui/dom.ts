// пR.2 (ADR-0037): спільний DOM-хелпер шару UI — винесено з main.ts без змін.
// Кидати українською за конвенцією ядра (AGENTS.md).

export function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('Немає елемента #' + id);
  return e as T;
}
