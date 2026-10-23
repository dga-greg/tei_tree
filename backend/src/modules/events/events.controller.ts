import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { createEventBody, eventListQuery, timelineQuery, updateEventBody, type EventsService } from './events.service.js';

export class EventsController {
  constructor(private readonly events: EventsService) {}

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.events.list(accessOf(req), parse(eventListQuery, req.query)) });
  };

  get = async (req: Request, res: Response) => {
    res.json({ data: await this.events.get(accessOf(req), parseIdParam(req.params['eventId'], 'Event')) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.events.create(accessOf(req), actorOf(req), parse(createEventBody, req.body)) });
  };

  update = async (req: Request, res: Response) => {
    res.json({ data: await this.events.update(accessOf(req), actorOf(req), parseIdParam(req.params['eventId'], 'Event'), parse(updateEventBody, req.body)) });
  };

  remove = async (req: Request, res: Response) => {
    await this.events.remove(accessOf(req), actorOf(req), parseIdParam(req.params['eventId'], 'Event'));
    res.status(204).end();
  };

  timeline = async (req: Request, res: Response) => {
    res.json(await this.events.timeline(accessOf(req), parse(timelineQuery, req.query)));
  };
}
