// Т.129 (ADR-0118): аватар оперативника «шолом» — SVG кодом, без генерації
// (рішення власника Т.125, «А. Шолом, малює код»). Колір візора й обідка —
// колір бійця (той самий, що кільце під ногами на полі), форма шолома — одна
// з трьох; обидва — за id ростера (`fighterLook`). Прототип — дизайн-сесія Т.125.
import { fighterLook } from '../core/render-core';

const HELMET_TOPS = ['M7 13a9 9 0 0 1 18 0v5H7z', 'M6 14c0-6 4-10 10-10s10 4 10 10v4H6z', 'M8 12l3-7h10l3 7v6H8z'];

// Т.130: clipPrefix — той самий боєць на сторінці двічі (ростер і смуга загону) не дає дубля id кліпа
// п21.4 (ADR-0178): ring — колір кільця й візора замість кольору бійця (техноманти — фіолет Розриву)
export function helmetSvg(id: string, size = 24, clipPrefix = 'av-cp-', ring?: string): string {
  const look = fighterLook(id);
  const c = ring ?? look.color;
  const shape = look.shape;
  const cp = clipPrefix + id; // id кліпа — за id бійця: у ростері кожен боєць один раз
  return (
    '<svg class="avatar" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 32 32" aria-hidden="true" data-shape="' +
    shape +
    '" data-color="' +
    c +
    '"><defs><clipPath id="' +
    cp +
    '"><circle cx="16" cy="16" r="15"/></clipPath></defs>' +
    '<circle cx="16" cy="16" r="15" fill="#0f1a2e"/><g clip-path="url(#' +
    cp +
    ')"><path d="M2 34c0-8 6-11 14-11s14 3 14 11z" fill="#2a3a5c"/><path d="M11 22h10v4H11z" fill="#1c2942"/>' +
    '<path d="' +
    HELMET_TOPS[shape] +
    '" fill="#3d5280"/><path d="M8 13h16v4.5H8z" fill="' +
    c +
    '"/><path d="M8 13h16v1.5H8z" fill="#fff" fill-opacity=".35"/><path d="M10 18h12l-2 5h-8z" fill="#22304f"/></g>' +
    '<circle cx="16" cy="16" r="14.5" fill="none" stroke="' +
    c +
    '" stroke-width="2"/></svg>'
  );
}
