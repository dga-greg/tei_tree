import type { Request, Response } from 'express';
import { parse } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import { accessOf } from '../families/family-access.js';
import { calendarQuery, type CalendarService } from '../calendar/calendar.service.js';
import { preferencesBody, subscriptionBody, unsubscribeBody, type NotificationsService } from './notifications.service.js';

export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly calendar: CalendarService,
  ) {}

  calendarItems = async (req: Request, res: Response) => {
    const q = parse(calendarQuery, req.query);
    res.json({ data: await this.calendar.items(accessOf(req), q.from, q.to) });
  };

  preferences = async (req: Request, res: Response) => {
    res.json({ data: await this.notifications.preferences(authOf(req).userId) });
  };

  setPreferences = async (req: Request, res: Response) => {
    res.json({ data: await this.notifications.setPreferences(authOf(req).userId, parse(preferencesBody, req.body)) });
  };

  pushStatus = async (req: Request, res: Response) => {
    res.json({ data: await this.notifications.pushStatus(authOf(req).userId) });
  };

  subscribe = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.notifications.subscribe(authOf(req).userId, parse(subscriptionBody, req.body), req.get('user-agent') ?? '') });
  };

  unsubscribe = async (req: Request, res: Response) => {
    res.json({ data: await this.notifications.unsubscribe(authOf(req).userId, parse(unsubscribeBody, req.body).endpoint) });
  };

  test = async (req: Request, res: Response) => {
    res.json({ data: await this.notifications.test(authOf(req).userId) });
  };

  digestPreview = async (req: Request, res: Response) => {
    res.json({ data: await this.notifications.digestPreview(authOf(req).userId) });
  };
}
