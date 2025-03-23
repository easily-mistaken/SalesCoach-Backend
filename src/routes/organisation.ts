import { Router } from 'express';

const organisationRouter = Router();

// TODO: Implement the route for creating a new organisation
organisationRouter.post('/', (req, res) => {
    const newOrganisation = req.body; 
    res.status(201).json({ message: 'Organisation created', organisation: newOrganisation });
});

// Export the organisation router
export default organisationRouter;
