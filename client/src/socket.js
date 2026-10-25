import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// One shared connection for the whole app. Pages connect on mount and disconnect on unmount.
export const socket = io(URL, {
  autoConnect: false,
});
