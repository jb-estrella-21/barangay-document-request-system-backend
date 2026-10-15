import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { hash, argon2id } from 'argon2';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { StaffRole } from '@prisma/client';
import { StaffUsersService } from '../staff-users/staff-users.service';

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Administrator bootstrap must run in an interactive terminal');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const users = app.get(StaffUsersService);
  try {
    const existing = await prisma.staffUser.count({ where: { role: StaffRole.ADMINISTRATOR } });
    if (existing) throw new Error('An administrator already exists; bootstrap is only for the first administrator');
    const username = (await readHidden('Administrator username: ')).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) throw new Error('Username must be 3-80 characters using letters, numbers, dot, underscore, or hyphen');
    const password = await readHidden('Password (minimum 12 characters): ');
    const confirm = await readHidden('Confirm password: ');
    if (password.length < 12) throw new Error('Password must contain at least 12 characters');
    if (password !== confirm) throw new Error('Passwords do not match');
    const passwordHash = await hash(password, { type: argon2id });
    await users.createFirstAdministrator(username, passwordHash);
    process.stdout.write(`Administrator ${username} created.\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Administrator bootstrap failed'}\n`);
  process.exitCode = 1;
});
