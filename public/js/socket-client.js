// Socket.IO client wrapper
const SocketClient = {
  socket: null,
  gameId: null,
  role: null,

  connect() {
    this.socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      console.log('Connected to server:', this.socket.id);
      // Each page (host/player/judge/game-screen) emits its own `rejoin`
      // on connect with the role-specific context it needs.
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    this.socket.on('error', (data) => {
      showToast(data.message, 'error');
    });

    // If the current game is deleted, leave gracefully (back to the start).
    this.socket.on('game-deleted', () => {
      this.clearSession();
      showToast('This game was ended by the host.', 'error');
      setTimeout(() => { window.location.href = '/'; }, 1500);
    });

    return this.socket;
  },

  saveSession(gameId, role) {
    this.gameId = gameId;
    this.role = role;
    sessionStorage.setItem('ff_gameId', gameId);
    sessionStorage.setItem('ff_role', role);
  },

  clearSession() {
    this.gameId = null;
    this.role = null;
    sessionStorage.removeItem('ff_gameId');
    sessionStorage.removeItem('ff_role');
  },

  emit(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  },

  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  },
};

// Toast notification helper
function showToast(message, type = 'error') {
  // Remove any existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
