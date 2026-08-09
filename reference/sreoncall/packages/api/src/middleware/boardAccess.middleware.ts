import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Project } from '../models/project.model';
import { BoardMember } from '../models/board-member.model';

export async function boardAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const projectId = req.params.projectId ?? (req.query.project_id as string | undefined) ?? (req.body?.project_id as string | undefined);

  if (!projectId) {
    next();
    return;
  }

  const project = await Project.findOne({
    _id: projectId,
    tenant_id: req.tenantId,
    deleted_at: null,
  }).select('visibility');

  if (!project) {
    res.status(404).json({
      type: 'https://sreoncall.io/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Board not found.',
    });
    return;
  }

  if (project.visibility === 'org') {
    next();
    return;
  }

  // private board
  if (req.roles?.includes('admin')) {
    next();
    return;
  }

  const member = await BoardMember.findOne({
    board_id: projectId,
    user_id: req.userId,
  });

  if (member) {
    next();
    return;
  }

  res.status(403).json({
    type: 'https://sreoncall.io/problems/forbidden',
    title: 'Forbidden',
    status: 403,
    detail: 'You do not have access to this board.',
  });
}
