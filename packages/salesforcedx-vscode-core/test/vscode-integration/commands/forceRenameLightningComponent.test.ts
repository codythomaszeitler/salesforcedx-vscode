import { notificationService } from '@salesforce/salesforcedx-utils-vscode/out/src/commands';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {RenameLwcComponentExecutor} from '../../../src/commands/forceRenameLightningComponent';

const lwcPath = vscode.Uri.parse('/force-app/main/default/lwc');
const auraPath = vscode.Uri.parse('/force-app/main/default/aura/');
const lwcComponent = 'hero';
const auraComponent = 'page';
const itemsInHero = ['_test_', 'hero.css', 'hero.html', 'hero.js', 'hero.js-meta.xml', 'templateOne.html'];
const itemsInPage = ['_test_', 'page.auradoc', 'page.cmp', 'page.cmp-meta.xml', 'page.css', 'page.design', 'page.svg', 'pageController.js', 'pageHelper.js', 'pageRenderer.js', 'templateOne.css'];

const env = sinon.createSandbox();
let renameStub: sinon.SinonStub;
let statStub: sinon.SinonStub;
let existStub: sinon.SinonStub;

describe('Force Rename Lightning Component', () => {
  describe('Happy Path Unit Test', () => {
    beforeEach(() => {
      renameStub = env.stub(fs, 'renameSync').returns(undefined);
      statStub = env.stub(fs, 'statSync').returns({
        isFile: () => {
          return false;
        }
      });
      existStub = env.stub(fs, 'existsSync').returns(false);
    });

    afterEach(() => {
      env.restore();
    });

    it('should rename the files and folder with new name under the same path and same file format', async () => {
      const sourceUri = vscode.Uri.joinPath(lwcPath, lwcComponent);
      env.stub(fs, 'readdirSync').returns([itemsInHero[1]]);
      const executor = new RenameLwcComponentExecutor(sourceUri.fsPath, 'hero1');
      await executor.run({
        type: 'CONTINUE',
        data: ''
      });
      const oldFilePath = path.join(sourceUri.fsPath, 'hero.css');
      const newFilePath = path.join(sourceUri.fsPath, 'hero1.css');
      const newFolderPath = path.join(lwcPath.fsPath, 'hero1');
      expect(renameStub.callCount).to.equal(2);
      expect(renameStub.calledWith(oldFilePath, newFilePath)).to.equal(true);
      expect(renameStub.calledWith(sourceUri.fsPath, newFolderPath)).to.equal(true);
    });

    it('should only rename the files and folder that have same name with LWC component', async () => {
      const sourceUri = vscode.Uri.joinPath(lwcPath, lwcComponent);
      env.stub(fs, 'readdirSync').returns(itemsInHero);
      const executor = new RenameLwcComponentExecutor(sourceUri.fsPath, 'hero1');
      await executor.run({
        type: 'CONTINUE',
        data: ''
      });
      expect(renameStub.callCount).to.equal(5);
    });

    it('should only rename the files and folder that have same name with Aura component', async () => {
      const sourceUri = vscode.Uri.joinPath(auraPath, auraComponent);
      env.stub(fs, 'readdirSync').returns(itemsInPage);
      const executor = new RenameLwcComponentExecutor(sourceUri.fsPath, 'page1');
      await executor.run({
        type: 'CONTINUE',
        data: ''
      });
      expect(renameStub.callCount).to.equal(10);
    });

    it('should show the warning message once rename is done', async () => {
      const sourceUri = vscode.Uri.joinPath(lwcPath, lwcComponent);
      env.stub(fs, 'readdirSync').returns([itemsInHero[1]]);
      const warningSpy = env.spy(notificationService, 'showWarningMessage');
      const executor = new RenameLwcComponentExecutor(sourceUri.fsPath, 'hero1');
      await executor.run({
        type: 'CONTINUE',
        data: ''
      });
      expect(warningSpy.callCount).to.equal(1);
    });
  });

  describe('Exception handling', () => {
    beforeEach(() => {
      renameStub = env.stub(fs, 'renameSync').returns(undefined);
      statStub = env.stub(fs, 'statSync').returns({
        isFile: () => {
          return false;
        }
      });
    });

    afterEach(() => {
      env.restore();
    });

    it('should not rename when input text is empty', async () => {
      const sourceUri = vscode.Uri.joinPath(lwcPath, lwcComponent);
      existStub = env.stub(fs, 'existsSync').returns(false);
      env.stub(fs, 'readdirSync').returns([itemsInHero[1]]);
      const executor = new RenameLwcComponentExecutor(sourceUri.fsPath, undefined);
      await executor.run({
        type: 'CONTINUE',
        data: ''
      });
      expect(renameStub.callCount).to.equal(0);
    });

    it('should not show warning message when input text is empty', async () => {
      const sourceUri = vscode.Uri.joinPath(lwcPath, lwcComponent);
      existStub = env.stub(fs, 'existsSync').returns(false);
      env.stub(fs, 'readdirSync').returns([itemsInHero[1]]);
      const warningSpy = env.spy(notificationService, 'showWarningMessage');
      const executor = new RenameLwcComponentExecutor(sourceUri.fsPath, undefined);
      await executor.run({
        type: 'CONTINUE',
        data: ''
      });
      expect(warningSpy.callCount).to.equal(0);
    });

    it('should enforce unique component name under LWC and Aura and show error message for duplicate name', async () => {
      const sourceUri = vscode.Uri.joinPath(lwcPath, lwcComponent);
      existStub = env.stub(fs, 'existsSync').returns(true);
      let exceptionThrown = false;
      try {
        const executor = new RenameLwcComponentExecutor(sourceUri.fsPath, 'hero');
        await executor.run({
          type: 'CONTINUE',
          data: ''
        });
      } catch (e) {
        exceptionThrown = true;
      }
      expect(exceptionThrown).to.equal(true);
      expect(renameStub.callCount).to.equal(0);
    });
  });

  describe('getComponentPath', () => {
    it('should return component path whatever file path or component path is given', () => {
    });
  });

  describe('isDuplicate', () => {
    it('should return true when new name already existed in LWC or Aura', () => {

    });
  });

  describe('isLwcComponent', () => {
    it('should know if it is LWC component based on component path', () => {

    });
  });
});
