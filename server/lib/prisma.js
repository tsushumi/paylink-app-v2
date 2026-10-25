const { PrismaClient } = require('@prisma/client');

// One shared client for the whole process (the lesson code created one per file).
const prisma = new PrismaClient();

module.exports = prisma;
