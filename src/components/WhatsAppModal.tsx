import React, { useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Phone, X } from 'lucide-react';
import { buildTelHref, buildWhatsAppHref } from '../core/rules';
import type { MessageDeliveryState } from '../core/types';
import { api } from '../lib/api';

export interface DraftMessageConfig {
  templateType: string;
  title: string;
  recipientLabel: string;
  recipientPhone: string;
  defaultBody: string;
}

interface WhatsAppModalProps {
  draft: DraftMessageConfig | null;
  onClose: () => void;
  onLogged?: () => void;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({ draft, onClose, onLogged }) => {
  const [body, setBody] = useState(draft?.defaultBody ?? '');
  const [deliveryState, setDeliveryState] = useState<MessageDeliveryState>('PREPARED');
  const [logId, setLogId] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (draft) {
      setBody(draft.defaultBody);
      setDeliveryState('PREPARED');
      setLogId(undefined);
      setCopied(false);
    }
  }, [draft]);

  if (!draft) return null;

  const waHref = buildWhatsAppHref(draft.recipientPhone, body);
  const telHref = buildTelHref(draft.recipientPhone);

  async function recordState(nextState: MessageDeliveryState) {
    setDeliveryState(nextState);
    try {
      const saved = await api.logMessage({
        templateType: draft!.templateType,
        recipientLabel: draft!.recipientLabel,
        recipientPhone: draft!.recipientPhone,
        body,
        deliveryState: nextState,
        existingId: logId,
      });
      setLogId(saved.id);
      onLogged?.();
    } catch {
      // keep UI responsive
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restriction
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={draft.title}
    >
      <div className="w-full sm:max-w-lg bg-[#18181a] rounded-t-lg sm:rounded-lg border border-[#f2efeb]/10 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f2efeb]/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-[#f2efeb] truncate">{draft.title}</h3>
            <p className="text-xs text-[#f2efeb]/60 truncate mt-0.5">
              {draft.recipientLabel} · {draft.recipientPhone}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close message drawer"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#f2efeb]/60 hover:bg-[#18181a]/[0.05] hover:text-[#f2efeb] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between text-xs text-[#f2efeb]/70 bg-[#1f1f23] px-3.5 py-2.5 rounded-[6px] border border-[#f2efeb]/10">
            <span>
              Delivery status:{' '}
              <strong className="text-[#f2efeb]">
                {deliveryState === 'PREPARED'
                  ? 'Prepared (not sent yet)'
                  : deliveryState === 'OPENED'
                  ? 'Opened in WhatsApp draft'
                  : 'Manually marked sent'}
              </strong>
            </span>
          </div>

          <div>
            <label htmlFor="wa-draft-body" className="block text-xs font-semibold text-[#f2efeb] mb-1.5">
              Editable Message Draft
            </label>
            <textarea
              id="wa-draft-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full p-3.5 rounded-[6px] border border-[#f2efeb]/10 text-sm text-[#f2efeb] leading-relaxed focus:outline-none focus:border-[#C81E2B] focus:ring-2 focus:ring-[#C81E2B]/35"
            />
            <p className="text-[11px] text-[#f2efeb]/60 mt-1.5">
              Opening WhatsApp prepares a pre-filled draft on your device. It does not auto-send or guarantee delivery; mark sent manually after confirming in WhatsApp.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#f2efeb]/10 bg-[#1f1f23] flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <a
              href={telHref}
              className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#C81E2B]/20 text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Phone className="w-3.5 h-3.5 text-[#f2efeb]" />
              Call
            </a>
            <button
              type="button"
              onClick={handleCopy}
              className="h-10 px-3 rounded-[6px] border border-[#f2efeb]/10 bg-[#18181a] hover:bg-[#C81E2B]/20 text-xs font-semibold text-[#f2efeb] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              onClick={() => recordState('OPENED')}
              className="h-10 px-4 rounded-[6px] bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Open WhatsApp
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              type="button"
              onClick={() => recordState('MANUALLY_SENT')}
              className="h-10 px-3.5 rounded-[6px] bg-[#C81E2B] hover:bg-[#A31621] text-white text-xs font-semibold whitespace-nowrap"
            >
              Mark Sent
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
