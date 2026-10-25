// Creates a demo merchant + payment link. Run: npm run db:seed
require('dotenv').config();
const prisma = require('../lib/prisma');

async function main() {
  const email = 'demo@paylink.test';
  const user =
    (await prisma.user.findUnique({ where: { email } })) ||
    (await prisma.user.create({
      data: { name: 'Demo Coffee Shop', email, phone: '0712345678' },
    }));

  const link = await prisma.paymentLink.create({
    data: { userId: user.id, description: 'Coffee & cake combo', amount: 2500 },
  });

  console.log('Demo merchant:', user.email, '(log in with this email)');
  console.log('Demo payment link: http://localhost:5173/pay/' + link.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
