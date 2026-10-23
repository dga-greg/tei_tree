import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { createPlaceBody, updatePlaceBody, type PlacesService } from './places.service.js';

const placeId = (req: Request) => parseIdParam(req.params['placeId'], 'Place');

export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  overview = async (req: Request, res: Response) => {
    res.json({ data: await this.places.overview(accessOf(req)) });
  };
  detail = async (req: Request, res: Response) => {
    res.json({ data: await this.places.detail(accessOf(req), placeId(req)) });
  };
  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.places.create(accessOf(req), actorOf(req), parse(createPlaceBody, req.body)) });
  };
  update = async (req: Request, res: Response) => {
    res.json({ data: await this.places.update(accessOf(req), actorOf(req), placeId(req), parse(updatePlaceBody, req.body)) });
  };
  remove = async (req: Request, res: Response) => {
    await this.places.remove(accessOf(req), actorOf(req), placeId(req));
    res.status(204).end();
  };
}
