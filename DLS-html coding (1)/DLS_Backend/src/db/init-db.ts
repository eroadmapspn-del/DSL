import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

async function init() {
  console.log('🔄 Connecting to PostgreSQL server...');
  
  // 1. Connect to default postgres DB
  const adminClient = new Client({
    user: 'postgres',
    host: '127.0.0.1',
    database: 'postgres',
    port: 5432
  });

  await adminClient.connect();
  console.log('✅ Connected to PostgreSQL server.');

  // Check if dls_beautybasket DB exists
  const checkRes = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = 'dls_beautybasket'");
  if (checkRes.rowCount === 0) {
    console.log('📦 Creating database "dls_beautybasket"...');
    await adminClient.query('CREATE DATABASE dls_beautybasket');
    console.log('✅ Database "dls_beautybasket" created.');
  } else {
    console.log('ℹ️ Database "dls_beautybasket" already exists.');
  }
  await adminClient.end();

  // 2. Connect to dls_beautybasket
  const appClient = new Client({
    user: 'postgres',
    host: '127.0.0.1',
    database: 'dls_beautybasket',
    port: 5432
  });

  await appClient.connect();
  console.log('✅ Connected to "dls_beautybasket" database.');

  // 3. Run sql/01_schema.sql
  const schemaPath = path.resolve(process.cwd(), 'sql/01_schema.sql');
  if (fs.existsSync(schemaPath)) {
    console.log('📜 Executing sql/01_schema.sql...');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await appClient.query(schemaSql);
    console.log('✅ Tables created successfully.');
  }

  // 4. Run sql/02_roles_and_permissions.sql
  const rolesPath = path.resolve(process.cwd(), 'sql/02_roles_and_permissions.sql');
  if (fs.existsSync(rolesPath)) {
    console.log('📜 Executing sql/02_roles_and_permissions.sql...');
    const rolesSql = fs.readFileSync(rolesPath, 'utf8');
    await appClient.query(rolesSql);
    console.log('✅ Roles and permissions seeded successfully.');
  }

  // 5. Run sql/03_rpc_functions.sql
  const rpcPath = path.resolve(process.cwd(), 'sql/03_rpc_functions.sql');
  if (fs.existsSync(rpcPath)) {
    console.log('📜 Executing sql/03_rpc_functions.sql...');
    const rpcSql = fs.readFileSync(rpcPath, 'utf8');
    await appClient.query(rpcSql);
    console.log('✅ Stored procedures created successfully.');
  }

  // 6. Ensure default admin user and profile exist
  const adminId = '00000000-0000-0000-0000-000000000001';
  const adminEmail = 'admin@beautybasket.com';

  // Create users table for auth if not exists
  await appClient.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  const passwordHash = bcrypt.hashSync('admin123', 10);
  await appClient.query(`
    INSERT INTO app_users (id, email, password_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE SET password_hash = $3;
  `, [adminId, adminEmail, passwordHash]);

  await appClient.query(`
    INSERT INTO user_profiles (id, user_id, email, full_name, department, is_active)
    VALUES ($1, $1, $2, 'System Admin', 'Management', TRUE)
    ON CONFLICT (id) DO UPDATE SET email = $2, is_active = TRUE;
  `, [adminId, adminEmail]);

  // Assign admin role
  const adminRoleRes = await appClient.query("SELECT id FROM roles WHERE name = 'admin' LIMIT 1");
  if (adminRoleRes.rowCount && adminRoleRes.rowCount > 0) {
    const adminRoleId = adminRoleRes.rows[0].id;
    await appClient.query(`
      INSERT INTO user_roles (id, user_id, role_id, assigned_by)
      VALUES (gen_random_uuid(), $1, $2, $1)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    `, [adminId, adminRoleId]);
  }

  console.log('✅ Default admin account ready in PostgreSQL:');
  console.log('   Email:    admin@beautybasket.com');
  console.log('   Password: admin123');

  await appClient.end();
  console.log('🎉 Database initialization complete!');
}

init().catch(err => {
  console.error('❌ Error initializing database:', err);
  process.exit(1);
});
