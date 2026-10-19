import { useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

type TerminalEvent = { output?: string | null; exited: boolean; error?: string | null };
type Props = { id: string; cwd: string; shell: string; theme: 'dark' | 'light'; fontSize: number; onExit: (id: string) => void; onError: (message: string) => void };

export function TerminalView({ id, cwd, shell, theme, fontSize, onExit, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const callbacks = useRef({ onExit, onError });
  callbacks.current = { onExit, onError };

  useEffect(() => {
    const element = host.current;
    if (!element || !cwd) return;
    let mounted = true;
    let spawned = false;
    let inputQueue: Promise<unknown> = Promise.resolve();
    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize,
      theme: theme === 'light'
        ? { background: '#ffffff', foreground: '#24262b', cursor: '#745a36', selectionBackground: '#9bb8ef66' }
        : { background: '#15161a', foreground: '#e2e3e8', cursor: '#d2b786', selectionBackground: '#c6a87855' },
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(element);
    const onOutput = new Channel<TerminalEvent>();
    onOutput.onmessage = event => {
      if (!mounted) return;
      if (event.output) terminal.write(event.output);
      if (event.error) { terminal.write(`\r\n\x1b[31m${event.error}\x1b[0m\r\n`); callbacks.current.onError(event.error); }
      if (event.exited) callbacks.current.onExit(id);
    };
    let resizeTimer: number | undefined;
    const fitAndResize = () => {
      if (!mounted) return;
      try {
        fit.fit();
        if (spawned) void invoke('terminal_resize', { id, cols: terminal.cols, rows: terminal.rows }).catch(error => callbacks.current.onError(`Terminal boyutu: ${String(error)}`));
      } catch (error) { callbacks.current.onError(`Terminal boyutlandırılamadı: ${String(error)}`); }
    };
    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(fitAndResize, 40);
    });
    resizeObserver.observe(element);
    const dataListener = terminal.onData(data => {
      inputQueue = inputQueue.then(() => invoke('terminal_write', { id, data })).catch(error => {
        if (mounted) callbacks.current.onError(`Terminal girdisi gönderilemedi: ${String(error)}`);
      });
    });
    terminal.attachCustomKeyEventHandler(event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
        void navigator.clipboard?.writeText(terminal.getSelection()).catch(error => callbacks.current.onError(`Panoya kopyalanamadı: ${String(error)}`));
        return false;
      }
      return true;
    });
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      void navigator.clipboard?.readText().then(text => { if (text) terminal.paste(text); }).catch(error => callbacks.current.onError(`Panodan yapıştırılamadı: ${String(error)}`));
    };
    element.addEventListener('contextmenu', contextMenu);
    requestAnimationFrame(() => {
      fitAndResize();
      void invoke('terminal_spawn', { id, cwd, shell, cols: terminal.cols || 80, rows: terminal.rows || 24, onOutput }).then(() => {
        spawned = true;
        fitAndResize();
        terminal.focus();
      }).catch(error => {
        if (mounted) { const message = `Terminal başlatılamadı: ${String(error)}`; terminal.write(`\x1b[31m${message}\x1b[0m\r\n`); callbacks.current.onError(message); }
      });
    });
    return () => {
      mounted = false;
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      element.removeEventListener('contextmenu', contextMenu);
      dataListener.dispose();
      terminal.dispose();
      terminalRef.current = null;
      if (spawned) void invoke('terminal_close', { id }).catch(error => callbacks.current.onError(`Terminal kapatılamadı: ${String(error)}`));
    };
  }, [id, cwd, shell]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.fontSize = fontSize;
      terminal.options.theme = theme === 'light'
        ? { background: '#ffffff', foreground: '#24262b', cursor: '#745a36', selectionBackground: '#9bb8ef66' }
        : { background: '#15161a', foreground: '#e2e3e8', cursor: '#d2b786', selectionBackground: '#c6a87855' };
    }
  }, [theme, fontSize]);

  return <div ref={host} className="terminal-view" aria-label="Etkileşimli terminal" />;
}
