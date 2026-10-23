import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { announcementBody, rsvpAnswerBody, rsvpTokenBody, type AnnouncementsService } from './announcements.service.js';

export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  status = async (req: Request, res: Response) => {
    res.json({ data: await this.announcements.status(accessOf(req)) });
  };

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.announcements.list(accessOf(req), parseIdParam(req.params['eventId'], 'Ceremony')) });
  };

  preview = async (req: Request, res: Response) => {
    res.json({ data: await this.announcements.preview(accessOf(req), parseIdParam(req.params['eventId'], 'Ceremony'), parse(announcementBody, req.body)) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.announcements.create(accessOf(req), actorOf(req), parseIdParam(req.params['eventId'], 'Ceremony'), parse(announcementBody, req.body)) });
  };

  recipients = async (req: Request, res: Response) => {
    res.json({ data: await this.announcements.recipients(accessOf(req), parseIdParam(req.params['announcementId'], 'Announcement')) });
  };

  /** Personal links: the token travels in the body, never in a URL the server logs. */
  rsvpView = async (req: Request, res: Response) => {
    res.json({ data: await this.announcements.rsvpView(parse(rsvpTokenBody, req.body).token) });
  };

  rsvpAnswer = async (req: Request, res: Response) => {
    const { token, answer } = parse(rsvpAnswerBody, req.body);
    res.json({ data: await this.announcements.rsvpAnswer(token, answer) });
  };
}
