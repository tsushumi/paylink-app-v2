// Holds the Socket.IO server so services can emit without circular imports.
let io = null;

module.exports = {
  setIo(instance) {
    io = instance;
  },
  getIo() {
    return io;
  },
  room: {
    link: (id) => `link:${id}`,
    payment: (id) => `payment:${id}`,
    merchant: (id) => `merchant:${id}`,
  },
};
