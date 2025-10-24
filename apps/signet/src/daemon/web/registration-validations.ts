import prisma from '../../db.js';

export async function validateRegistration(request: any): Promise<void> {
    const { username, domain, email, password } = request.body ?? {};

    if (!username || !domain) {
        throw new Error('Username and domain are required');
    }

    const existingUser = await prisma.user.findUnique({
        where: { username, domain },
    });

    if (existingUser) {
        throw new Error('Username already exists. If this is your account, log in instead.');
    }

    if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
    }

    if (email) {
        if (!email.includes('@')) {
            throw new Error('Invalid email address');
        }

        const emailRecord = await prisma.user.findFirst({ where: { email } });
        if (emailRecord) {
            throw new Error('Email is already associated with another account');
        }
    }
}
