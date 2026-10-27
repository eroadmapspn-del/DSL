import app from './app.js';
import { ENV } from './config/env.js';

const PORT = ENV.PORT;

app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 DLS BeautyBasket Backend is running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔑 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`🛡️  Admin Dashboard APIs: http://localhost:${PORT}/api/admin`);
  console.log(`🔐 Auth APIs: http://localhost:${PORT}/api/auth`);
  console.log(`⚡ RPC Functions: http://localhost:${PORT}/api/rpc`);
  console.log(`====================================================`);
  console.log(`👉 Default Admin Account:`);
  console.log(`   Email:    admin@beautybasket.com`);
  console.log(`   Password: admin123`);
  console.log('====================================================');
});
