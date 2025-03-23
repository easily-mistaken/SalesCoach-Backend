import { NextFunction, Request, Response } from 'express';

export const adminOrManagerOfOrg = (req: Request, res: Response, next: NextFunction): void => {
    // @ts-ignore
    const user = req.user;
    const { organizationId } = req.params;
    
    if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    // check if the user is part of the organization
    const userOrganization = user.organizations.find((organization: any) => organization.organizationId === organizationId);
    if (!userOrganization) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    next();
};
