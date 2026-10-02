const THREAD_TELL_INVOCATION_PATTERN =
  /(?:^|[\s;&|(`'"])(?:[^\s;&|(`'"]*\/)?(?:bb|"?\$\{?BB_CLI\}?"?)\s+thread\s+(?:tell|message)\b/;
const THREAD_ID_PATTERN = /\b(thr_[a-z0-9]+)\b/;
const HEREDOC_PATTERN =
  /<<-?\s*(['"]?)([A-Za-z_][\w]*)\1[^\n]*\n([\s\S]*?)\n\s*\2(?:\s|$)/;
const QUOTED_ARGUMENT_PATTERN = /(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1/;

export interface AgentThreadTellCommand {
  message: string | null;
  targetThreadId: string;
}

function unescapeShellArgument(quote: string, value: string): string {
  if (quote === "'") {
    return value;
  }
  return value.replace(/\\(["\\$`])/g, "$1");
}

function parseTellMessage(argumentsText: string): string | null {
  const heredoc = HEREDOC_PATTERN.exec(argumentsText);
  if (heredoc?.[3] !== undefined) {
    return heredoc[3];
  }
  if (/\s--message-file\b/.test(argumentsText)) {
    return null;
  }
  const quoted = QUOTED_ARGUMENT_PATTERN.exec(argumentsText);
  if (quoted?.[1] === undefined || quoted[2] === undefined) {
    return null;
  }
  return unescapeShellArgument(quoted[1], quoted[2]);
}

export function parseAgentThreadTellCommand(
  command: string,
): AgentThreadTellCommand | null {
  const invocation = THREAD_TELL_INVOCATION_PATTERN.exec(command);
  if (invocation === null) {
    return null;
  }
  const argumentsText = command.slice(invocation.index + invocation[0].length);
  if (/\s(?:-h|--help)\b/.test(argumentsText)) {
    return null;
  }
  const targetThreadId = THREAD_ID_PATTERN.exec(argumentsText)?.[1];
  if (targetThreadId === undefined) {
    return null;
  }
  const afterTarget = argumentsText.slice(
    argumentsText.indexOf(targetThreadId) + targetThreadId.length,
  );
  const message = parseTellMessage(afterTarget);
  return {
    message: message === null || message.trim().length === 0 ? null : message,
    targetThreadId,
  };
}
