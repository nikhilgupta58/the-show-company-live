// The enquiry forms: EmailJS, with a way out when it fails.
//
// Production (site-contract.md §6) posts each form with emailjs.sendForm(service, template, form):
// every named control becomes a template variable. This keeps that exactly: same service, same two
// templates, same public key, same field names, same analytics event, same button strings.
// What changes:
//   · the SDK is bundled from npm (@emailjs/browser, BSD-3-Clause, 1.3 KB compressed) into this
//     script, instead of a CDN tag. It is not fetched separately at the moment of sending: a
//     chunk that failed to load once could never be retried (the browser caches the failed
//     import), so "Try again" would have been a dead end
//   · a honeypot. A filled trap is answered with a fake success and nothing is sent. The trap is
//     disabled for the moment of sending, so it never becomes a template variable
//   · a real failure path. If the send is rejected or nothing answers in 20 seconds, the button
//     recovers, the visitor's input is kept, and call / WhatsApp / email are offered in place.
//     (Production's button stays on "Sending..." for good.) A send that is still on its way is
//     never sent twice: a retry waits for it, and if it lands late the form says so
//   · our own validation (novalidate): each blocked field gets aria-invalid and a message
//     under it, the first one takes focus, and the live region says how many need attention
//   · results are announced in a live region, not only swapped on the button.
import emailjs from '@emailjs/browser';
import { formatBudget } from './budget.js';

declare global {
  interface Window {
    emailjs?: typeof import('@emailjs/browser').default;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const SERVICE_ID = 'service_p7e6via';
const TEMPLATES = { booking: 'template_j8f54gl', query: 'template_y4r8oub' } as const;
const SENT = { booking: 'Enquiry Sent ✓', query: 'Message Sent ✓' } as const;
const TIMEOUT_MS = 20_000;
const RESET_MS = 3000;

type Kind = keyof typeof TEMPLATES;

window.emailjs = emailjs;
// Written as a literal on purpose: build-tools/verify-redesign.mjs reads the key from here.
window.emailjs.init('ypAwRD-OQwNtchzlS');

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
/** What to do about one blocked field, in the site's own words (not the browser's bubble). */
function advice(control: Control) {
  const v = control.validity;
  if (v.valueMissing) return control instanceof HTMLSelectElement ? 'Choose one.' : 'Fill this in.';
  if (v.typeMismatch && control.type === 'email') return 'Enter a full email address, like name@example.com.';
  return control.validationMessage;
}
/** Mark or clear one field (aria-invalid and the message line Field.astro renders). */
function mark(control: Control, message: string) {
  const line = control.id ? document.getElementById(`${control.id}-error`) : null;
  if (message) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
  if (line) line.textContent = message;
}

const timeout = (ms: number) => new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error(`No answer from EmailJS after ${ms / 1000}s`)), ms));

/** Build the failure note (what happened, then call / WhatsApp / email) from the element's data attributes. */
function writeNote(box: HTMLElement) {
  const p = document.createElement('p');
  const lead = document.createElement('strong');
  lead.textContent = box.dataset.lead ?? '';
  p.append(lead, ` ${box.dataset.text ?? ''}`);
  const list = document.createElement('ul');
  list.className = 'form__routes';
  for (const route of JSON.parse(box.dataset.routes ?? '[]') as { href: string; label: string; external?: boolean }[]) {
    const a = document.createElement('a');
    a.className = 'link';
    a.href = route.href;
    a.textContent = route.label;
    if (route.external) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    const li = document.createElement('li');
    li.append(a);
    list.append(li);
  }
  box.append(p, list);
}

function wire(form: HTMLFormElement) {
  const kind = form.dataset.enquiry as Kind;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const label = button?.querySelector<HTMLElement>('.btn__label') ?? button;
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  const fallback = form.querySelector<HTMLElement>('[data-form-fallback]');
  const trap = form.querySelector<HTMLInputElement>('[data-form-trap]');
  if (!button || !label || !(kind in TEMPLATES)) return;
  const idle = label.textContent ?? '';
  let timer = 0;
  // While sending (and while "Sent" shows) the button is aria-disabled, not disabled, so a
  // keyboard user's focus stays on it.
  let busy = false;
  const lock = (on: boolean) => {
    busy = on;
    if (on) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  };
  let inflight: Promise<unknown> | null = null; // a send that has not answered yet
  let gaveUp = false; // the visitor was told it failed while it was still on its way
  form.noValidate = true;
  const controls = () => Array.from(form.elements).filter((el): el is Control => (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && !el.hasAttribute('data-form-trap'));
  // A marked field is cleared as soon as it is fixed.
  form.addEventListener('input', (event) => {
    const control = event.target as Control;
    if (control.getAttribute?.('aria-invalid') === 'true' && control.checkValidity()) mark(control, '');
  });
  form.addEventListener('change', (event) => {
    const control = event.target as Control;
    if (control.getAttribute?.('aria-invalid') === 'true' && control.checkValidity()) mark(control, '');
  });

  const say = (text: string) => {
    if (status) status.textContent = text;
  };
  const settle = (text: string, then?: () => void) => {
    label.textContent = text;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      label.textContent = idle;
      then?.();
    }, RESET_MS);
  };
  const succeed = () => {
    if (fallback) fallback.hidden = true;
    lock(true);
    say(kind === 'booking' ? 'Enquiry sent. We will get back to you within 24 hours.' : 'Message sent. We will get back to you within 24 hours.');
    settle(SENT[kind], () => {
      lock(false);
      form.reset();
    });
  };
  const track = () => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'generate_lead', form_type: kind });
    if (window.gtag) window.gtag('event', 'generate_lead', { form_type: kind });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    window.clearTimeout(timer);
    if (fallback) fallback.hidden = true;

    const blocked = controls().filter((control) => !control.checkValidity());
    controls().forEach((control) => mark(control, blocked.includes(control) ? advice(control) : ''));
    if (blocked.length) {
      label.textContent = idle;
      say(blocked.length === 1 ? 'One field needs attention.' : `${blocked.length} fields need attention.`);
      blocked[0].focus();
      return;
    }

    lock(true);
    label.textContent = 'Sending...';
    say('Sending your enquiry.');

    if (trap?.value) {
      // A bot filled the field no person can see. Look successful, send nothing.
      window.setTimeout(succeed, 600);
      return;
    }
    try {
      if (!inflight) {
        if (trap) trap.disabled = true; // disabled controls are left out of FormData
        // sendForm reads the fields now; the trap can be re-enabled straight after.
        const send = emailjs.sendForm(SERVICE_ID, TEMPLATES[kind], form);
        if (trap) trap.disabled = false;
        inflight = send;
        send.then(
          () => {
            inflight = null;
            // It landed after the visitor was told it had failed: say so, once.
            if (gaveUp) {
              gaveUp = false;
              track();
              succeed();
            }
          },
          () => {
            inflight = null;
          },
        );
      }
      gaveUp = false; // someone is waiting for it again: this path reports the answer
      await Promise.race([inflight, timeout(TIMEOUT_MS)]);
      track();
      succeed();
    } catch (error) {
      if (inflight) gaveUp = true;
      console.error(`EmailJS ${kind} error:`, error);
      lock(false);
      say('');
      if (fallback) {
        if (!fallback.childElementCount) writeNote(fallback);
        fallback.hidden = false;
        fallback.focus();
      }
      settle('Failed — Try Again');
    } finally {
      if (trap) trap.disabled = false;
    }
  });
}

document.querySelectorAll<HTMLFormElement>('form[data-enquiry]').forEach(wire);
document.querySelectorAll<HTMLInputElement>('[data-budget]').forEach((input) => {
  let previous = input.value;
  input.addEventListener('input', () => {
    input.value = formatBudget(input.value, previous);
    previous = input.value;
  });
});
