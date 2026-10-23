import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { createStoryBody, storyListQuery, updateStoryBody, type StoriesService } from './stories.service.js';

export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  list = async (req: Request, res: Response) => {
    res.json(await this.stories.list(accessOf(req), parse(storyListQuery, req.query)));
  };

  get = async (req: Request, res: Response) => {
    res.json({ data: await this.stories.view(accessOf(req), parseIdParam(req.params['storyId'], 'Story')) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.stories.create(accessOf(req), actorOf(req), parse(createStoryBody, req.body)) });
  };

  update = async (req: Request, res: Response) => {
    res.json({ data: await this.stories.update(accessOf(req), actorOf(req), parseIdParam(req.params['storyId'], 'Story'), parse(updateStoryBody, req.body)) });
  };

  remove = async (req: Request, res: Response) => {
    await this.stories.remove(accessOf(req), actorOf(req), parseIdParam(req.params['storyId'], 'Story'));
    res.status(204).end();
  };
}
