import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { mediaListQuery, tagsBody, updateMediaBody, type MediaService } from './media.service.js';

export class MediaController {
  constructor(private readonly media: MediaService) {}

  list = async (req: Request, res: Response) => {
    res.json(await this.media.list(accessOf(req), parse(mediaListQuery, req.query)));
  };

  upload = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.media.upload(accessOf(req), actorOf(req), req) });
  };

  get = async (req: Request, res: Response) => {
    res.json({ data: await this.media.view(accessOf(req), parseIdParam(req.params['mediaId'], 'File')) });
  };

  update = async (req: Request, res: Response) => {
    res.json({ data: await this.media.update(accessOf(req), actorOf(req), parseIdParam(req.params['mediaId'], 'File'), parse(updateMediaBody, req.body)) });
  };

  tags = async (req: Request, res: Response) => {
    res.json({ data: await this.media.setTags(accessOf(req), actorOf(req), parseIdParam(req.params['mediaId'], 'File'), parse(tagsBody, req.body)) });
  };

  remove = async (req: Request, res: Response) => {
    await this.media.remove(accessOf(req), actorOf(req), parseIdParam(req.params['mediaId'], 'File'));
    res.status(204).end();
  };

  removed = async (req: Request, res: Response) => {
    res.json({ data: await this.media.listRemoved(accessOf(req)) });
  };

  restore = async (req: Request, res: Response) => {
    res.json({ data: await this.media.restore(accessOf(req), actorOf(req), parseIdParam(req.params['mediaId'], 'File')) });
  };

  /** Redirects to a short-lived signed link, so <img>, <audio> and download links can point here. */
  content = async (req: Request, res: Response) => {
    const url = await this.media.contentUrl(accessOf(req), parseIdParam(req.params['mediaId'], 'File'), {
      thumb: req.query['variant'] === 'thumb',
      download: req.query['download'] === '1',
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, url);
  };
}
