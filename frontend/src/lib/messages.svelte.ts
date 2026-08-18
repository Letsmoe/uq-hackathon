export type Message = {
  id: number;
  from: string;
  subject: string;
  body: string;
  read: boolean;
};

/** System notices shown in the mail panel. The badge counts the unread ones. */
export const messages = $state<Message[]>([
  {
    id: 1,
    from: "Protocol",
    subject: "Welcome to Synapse",
    body: "Upload any track and a chart is generated for it on device. Pick a difficulty, then start.",
    read: false,
  },
  {
    id: 2,
    from: "Protocol",
    subject: "Calibrate your offset",
    body: "Hitting consistently late? Raise the audio offset in settings until the judgment feels centred.",
    read: false,
  },
]);

export function markRead(id: number) {
  const message = messages.find((candidate) => candidate.id === id);
  if (!message) {
    return;
  }
  message.read = true;
}
