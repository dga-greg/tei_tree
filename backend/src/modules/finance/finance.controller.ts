import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { contentDisposition } from '../../infra/storage.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { contributionBody, createFundBody, reportQuery, updateContributionBody, updateFundBody, type FinanceService } from './finance.service.js';

const fundId = (req: Request) => parseIdParam(req.params['fundId'], 'Fund');

export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.finance.list(accessOf(req)) });
  };
  mine = async (req: Request, res: Response) => {
    res.json({ data: await this.finance.mine(accessOf(req)) });
  };
  get = async (req: Request, res: Response) => {
    res.json({ data: await this.finance.get(accessOf(req), fundId(req)) });
  };
  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.finance.create(accessOf(req), actorOf(req), parse(createFundBody, req.body)) });
  };
  update = async (req: Request, res: Response) => {
    res.json({ data: await this.finance.update(accessOf(req), actorOf(req), fundId(req), parse(updateFundBody, req.body)) });
  };
  remove = async (req: Request, res: Response) => {
    await this.finance.remove(accessOf(req), actorOf(req), fundId(req));
    res.status(204).end();
  };
  contributions = async (req: Request, res: Response) => {
    res.json({ data: await this.finance.contributions(accessOf(req), fundId(req)) });
  };
  addContribution = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.finance.addContribution(accessOf(req), actorOf(req), fundId(req), parse(contributionBody, req.body)) });
  };
  updateContribution = async (req: Request, res: Response) => {
    res.json({ data: await this.finance.updateContribution(accessOf(req), actorOf(req), fundId(req), parseIdParam(req.params['contributionId'], 'Contribution'), parse(updateContributionBody, req.body)) });
  };
  removeContribution = async (req: Request, res: Response) => {
    await this.finance.removeContribution(accessOf(req), actorOf(req), fundId(req), parseIdParam(req.params['contributionId'], 'Contribution'));
    res.status(204).end();
  };
  report = async (req: Request, res: Response) => {
    res.json({ data: await this.finance.report(accessOf(req), fundId(req), parse(reportQuery, req.query)) });
  };
  csv = async (req: Request, res: Response) => {
    const file = await this.finance.csv(accessOf(req), actorOf(req), fundId(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition('attachment', file.filename));
    res.send(file.body);
  };
}
