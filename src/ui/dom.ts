// пR.2 (ADR-0037): спільний DOM-хелпер шару UI — винесено з main.ts без змін.
// Кидати українською за конвенцією ядра (AGENTS.md).

export function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('Немає елемента #' + id);
  return e as T;
}

// Т.43 (огляд Т.30, знахідка 14): причина неактивної кнопки — рядком одразу під
// нею (спливну підказку title на iPad не видно). Текст — той самий, що в title:
// виклик передає btn.title, коли причина є, інакше null (рядок прибирається).
// Кнопка вже має бути в документі або в батьківському елементі.
export function setWhy(btn: HTMLButtonElement, reason: string | null): void {
  const next = btn.nextElementSibling;
  if (next?.classList.contains('btn-why')) next.remove();
  if (reason === null) return;
  const row = document.createElement('div');
  row.className = 'btn-why';
  row.textContent = reason;
  btn.after(row);
}
