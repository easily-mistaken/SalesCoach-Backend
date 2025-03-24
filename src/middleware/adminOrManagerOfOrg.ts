import { NextFunction, Request, Response } from 'express';

export const adminOrManagerOfOrg = (req: Request, res: Response, next: NextFunction): void => {
    // @ts-ignore
    const user = req.user;
    const organizationId = req.params.organizationId || req.body.organizationId;
    
    if (user.role != 'ADMIN' && user.role != 'MANAGER') {
        console.log('user is not admin or manager');
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    const userOrganization = user.organizations.find((organization: any) => organization.organizationId.toString() == organizationId);
    if (!userOrganization) {
        console.log('user is not part of the organization');
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    next();
};
