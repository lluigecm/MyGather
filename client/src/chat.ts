// Painel de chat de texto (Etapa 6).
// Mensagens são efêmeras: vivem só no DOM, nada é persistido (spec, seção 2).

import { type ChatMessage } from './network.js';

/** Quantas mensagens manter no log antes de descartar as mais antigas. */
const MAX_MESSAGES = 200;

export class ChatPanel {
  constructor(
    private readonly log: HTMLElement,
    private readonly input: HTMLInputElement,
    onSend: (text: string) => void
  ) {
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const text = this.input.value.trim();
      if (text.length === 0) return;
      this.input.value = '';
      onSend(text);
    });
  }

  /** Habilita o input só quando a rede estiver pronta. */
  setEnabled(enabled: boolean, placeholder?: string): void {
    this.input.disabled = !enabled;
    if (placeholder !== undefined) this.input.placeholder = placeholder;
  }

  /**
   * Adiciona uma mensagem ao log. `selfId` marca as próprias mensagens e
   * `authorName` é o nome do remetente (cai no id abreviado se desconhecido).
   */
  addMessage(msg: ChatMessage, selfId: string | null, authorName?: string | null): void {
    const isSelf = msg.from === selfId;

    const line = document.createElement('div');
    line.className = isSelf ? 'chat-msg chat-msg--self' : 'chat-msg';

    const author = document.createElement('span');
    author.className = 'chat-author';
    author.textContent = isSelf ? 'você' : (authorName ?? msg.from.slice(0, 6));

    const body = document.createElement('span');
    // textContent (nunca innerHTML): o texto vem de outro usuário.
    body.textContent = msg.text;

    line.append(author, document.createTextNode(' '), body);
    this.log.appendChild(line);

    while (this.log.childElementCount > MAX_MESSAGES) {
      this.log.firstElementChild?.remove();
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** Aviso do sistema (ex.: sem conexão), visualmente distinto. */
  addSystemMessage(text: string): void {
    const line = document.createElement('div');
    line.className = 'chat-msg chat-msg--system';
    line.textContent = text;
    this.log.appendChild(line);
    this.log.scrollTop = this.log.scrollHeight;
  }
}
