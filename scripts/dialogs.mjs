import { escapeHTML as esc } from './core.mjs';

export async function formDialog(title, body, label = 'Apply', width = 580, extraButtons = []) {
  const content = document.createElement('div');
  // Foundry 14 requires the supplied outer DIV to have no attributes.
  // Put our styling on a child, retaining the native dialog's single form.
  content.innerHTML = `<div class="gcs-form">${body}</div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title },
    position: { width },
    classes: ['gcs-dialog'],
    rejectClose: false,
    content,
    buttons: [
      ...extraButtons.map(([action, label]) => ({
        action,
        label,
        callback: () => {
          const data = new FormData();
          data.set('_gcsAction', action);
          return data;
        },
      })),
      {
        action: 'apply',
        label,
        default: true,
        callback: (_event, button, dialog) =>
          new FormData(button.form || dialog.form || dialog.element.querySelector('form')),
      },
      { action: 'cancel', label: 'Cancel', callback: () => null },
    ],
  });
  return result instanceof FormData ? result : null;
}
export const field = (label, input, note = '') =>
  `<label class="gcs-field"><span>${esc(label)}</span>${input}${note ? `<small>${esc(note)}</small>` : ''}</label>`;
export const numberInput = (name, value = 0) =>
  `<input type="number" name="${esc(name)}" value="${esc(value)}" min="-100" max="100" step="1">`;
export const textInput = (name, value = '', placeholder = '') =>
  `<input type="text" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="160">`;
export const option = (value, label, selected = false) =>
  `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
export const checkbox = (name, value, label, checked = false, disabled = false) =>
  `<label class="gcs-check"><input type="checkbox" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}> <span>${esc(label)}</span></label>`;
