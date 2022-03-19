/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { getTestResultsFolder } from '@salesforce/salesforcedx-utils-vscode/out/src/helpers';
import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/lib/main';
import { CodeCoverage, StatusBarToggle } from './codecoverage';
import {
  forceApexDebugClassRunCodeActionDelegate,
  forceApexDebugMethodRunCodeActionDelegate,
  forceApexExecute,
  forceApexLogGet,
  forceApexTestClassRunCodeAction,
  forceApexTestClassRunCodeActionDelegate,
  forceApexTestMethodRunCodeAction,
  forceApexTestMethodRunCodeActionDelegate,
  forceApexTestRun,
  forceApexTestSuiteAdd,
  forceApexTestSuiteCreate,
  forceApexTestSuiteRun,
} from './commands';
import { APEX_EXTENSION_NAME, LSP_ERR } from './constants';
import { workspaceContext } from './context';
import {
  ClientStatus,
  enableJavaDocSymbols,
  getApexTests,
  getExceptionBreakpointInfo,
  getLineBreakpointInfo,
  languageClientUtils,
} from './languageClientUtils';
import * as languageServer from './languageServer';
import { nls } from './messages';
import { telemetryService } from './telemetry';
import { ApexTestOutlineProvider, TestNode } from './views/testOutlineProvider';
import { ApexTestRunner, TestRunType } from './views/testRunner';

let languageClient: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const extensionHRStart = process.hrtime();
  const testOutlineProvider = new ApexTestOutlineProvider(null);
  if (vscode.workspace && vscode.workspace.workspaceFolders) {
    const apexDirPath = getTestResultsFolder(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      'apex'
    );

    const testResultOutput = path.join(apexDirPath, '*.json');
    const testResultFileWatcher =
      vscode.workspace.createFileSystemWatcher(testResultOutput);
    testResultFileWatcher.onDidCreate((uri) =>
      testOutlineProvider.onResultFileCreate(apexDirPath, uri.fsPath)
    );
    testResultFileWatcher.onDidChange((uri) =>
      testOutlineProvider.onResultFileCreate(apexDirPath, uri.fsPath)
    );

    context.subscriptions.push(testResultFileWatcher);
  } else {
    throw new Error(nls.localize('cannot_determine_workspace'));
  }

  // Workspace Context
  await workspaceContext.initialize(context);

  // Telemetry
  const extensionPackage = require(context.asAbsolutePath('./package.json'));
  await telemetryService.initializeService(
    context,
    APEX_EXTENSION_NAME,
    extensionPackage.aiKey,
    extensionPackage.version
  );

  // Initialize Apex language server
  try {
    const langClientHRStart = process.hrtime();
    languageClient = await languageServer.createLanguageServer(context);
    languageClientUtils.setClientInstance(languageClient);
    const handle = languageClient.start();
    languageClientUtils.setStatus(ClientStatus.Indexing, '');
    context.subscriptions.push(handle);

    languageClient
      .onReady()
      .then(async () => {
        if (languageClient) {
          languageClient.onNotification('indexer/done', async () => {
            await testOutlineProvider.refresh();
          });
        }
        // TODO: This currently keeps existing behavior in which we set the language
        // server to ready before it finishes indexing. We'll evaluate this in the future.
        languageClientUtils.setStatus(ClientStatus.Ready, '');
        const startTime = telemetryService.getEndHRTime(langClientHRStart);
        telemetryService.sendEventData('apexLSPStartup', undefined, {
          activationTime: startTime,
        });
      })
      .catch((err) => {
        // Handled by clients
        telemetryService.sendException(LSP_ERR, err.message);
        languageClientUtils.setStatus(
          ClientStatus.Error,
          nls.localize('apex_language_server_failed_activate')
        );
      });
  } catch (e) {
    console.error('Apex language server failed to initialize');
    languageClientUtils.setStatus(ClientStatus.Error, e);
  }

  // Javadoc support
  enableJavaDocSymbols();

  // Commands
  const commands = registerCommands(context);
  context.subscriptions.push(commands);

  const registeredItems = await registerTestView(testOutlineProvider);
  context.subscriptions.push(registeredItems.viewItems);

  const focusOnTestItem = async (testName: string) => {
    const foundTestNode = testOutlineProvider.getTestNode(testName);

    const treeView = registeredItems.treeView;
    if (foundTestNode) {
      await treeView.reveal(foundTestNode, {
        focus: true,
        select: true,
        expand: true,
      });
    }
  };

  const exportedApi = {
    getLineBreakpointInfo,
    getExceptionBreakpointInfo,
    getApexTests,
    languageClientUtils,
    focusOnTestItem,
  };

  telemetryService.sendExtensionActivationEvent(extensionHRStart);
  return exportedApi;
}

function registerCommands(
  extensionContext: vscode.ExtensionContext
): vscode.Disposable {
  // Colorize code coverage
  const statusBarToggle = new StatusBarToggle();
  const colorizer = new CodeCoverage(statusBarToggle);
  const forceApexToggleColorizerCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.toggle.colorizer',
    () => colorizer.toggleCoverage()
  );

  // Customer-facing commands
  const forceApexTestClassRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.class.run.delegate',
    forceApexTestClassRunCodeActionDelegate
  );
  const forceApexTestLastClassRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.last.class.run',
    forceApexTestClassRunCodeAction
  );
  const forceApexTestClassRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.class.run',
    forceApexTestClassRunCodeAction
  );
  const forceApexTestMethodRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.method.run.delegate',
    forceApexTestMethodRunCodeActionDelegate
  );
  const forceApexDebugClassRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.debug.class.run.delegate',
    forceApexDebugClassRunCodeActionDelegate
  );
  const forceApexDebugMethodRunDelegateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.debug.method.run.delegate',
    forceApexDebugMethodRunCodeActionDelegate
  );
  const forceApexLogGetCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.log.get',
    forceApexLogGet
  );
  const forceApexTestLastMethodRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.last.method.run',
    forceApexTestMethodRunCodeAction
  );
  const forceApexTestMethodRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.method.run',
    forceApexTestMethodRunCodeAction
  );
  const forceApexTestSuiteCreateCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.suite.create',
    forceApexTestSuiteCreate
  );
  const forceApexTestSuiteRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.suite.run',
    forceApexTestSuiteRun
  );
  const forceApexTestSuiteAddCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.suite.add',
    forceApexTestSuiteAdd
  );
  const forceApexTestRunCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.test.run',
    forceApexTestRun
  );
  const forceApexExecuteDocumentCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.execute.document',
    forceApexExecute,
    false
  );
  const forceApexExecuteSelectionCmd = vscode.commands.registerCommand(
    'sfdx.force.apex.execute.selection',
    forceApexExecute,
    true
  );
  return vscode.Disposable.from(
    forceApexDebugClassRunDelegateCmd,
    forceApexDebugMethodRunDelegateCmd,
    forceApexExecuteDocumentCmd,
    forceApexExecuteSelectionCmd,
    forceApexLogGetCmd,
    forceApexTestClassRunCmd,
    forceApexTestClassRunDelegateCmd,
    forceApexTestLastClassRunCmd,
    forceApexTestLastMethodRunCmd,
    forceApexTestMethodRunCmd,
    forceApexTestMethodRunDelegateCmd,
    forceApexTestRunCmd,
    forceApexToggleColorizerCmd,
    forceApexTestSuiteCreateCmd,
    forceApexTestSuiteRunCmd,
    forceApexTestSuiteAddCmd
  );
}

class TestViewResult {
  public treeView: vscode.TreeView<TestNode>;
  public viewItems: vscode.Disposable;

  public constructor(
    treeView: vscode.TreeView<TestNode>,
    viewItems: vscode.Disposable
  ) {
    this.treeView = treeView;
    this.viewItems = viewItems;
  }
}

async function registerTestView(
  testOutlineProvider: ApexTestOutlineProvider
): Promise<TestViewResult> {
  // Create TestRunner
  const testRunner = new ApexTestRunner(testOutlineProvider);

  // Test View
  const testViewItems = new Array<vscode.Disposable>();

  const testProvider = vscode.window.createTreeView('sfdx.force.test.view', {
    treeDataProvider: testOutlineProvider,
  });

  testProvider.reveal(testOutlineProvider.getHead());

  testViewItems.push(testProvider);

  // Run Test Button on Test View command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.force.test.view.run', () =>
      testRunner.runAllApexTests()
    )
  );
  // Show Error Message command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.force.test.view.showError', (test) =>
      testRunner.showErrorMessage(test)
    )
  );
  // Show Definition command
  testViewItems.push(
    vscode.commands.registerCommand(
      'sfdx.force.test.view.goToDefinition',
      (test) => testRunner.showErrorMessage(test)
    )
  );
  // Run Class Tests command
  testViewItems.push(
    vscode.commands.registerCommand(
      'sfdx.force.test.view.runClassTests',
      (test) => testRunner.runApexTests([test.name], TestRunType.Class)
    )
  );
  // Run Single Test command
  // Is this the thing that is being ran when we press the button?
  // I mean if we put a console log in here we can tell that very easily.
  testViewItems.push(
    vscode.commands.registerCommand(
      'sfdx.force.test.view.runSingleTest',
      (test) => {
        console.log('We are in the sfdx.force.test.view.runSingleTest method');
        console.log(test);
        // Becuase the information right here is what is necessary to know if you really wanted to focus on the explorer.

        // But if we can figure out there is only one test per
        testRunner.runApexTests([test.name], TestRunType.Method);
      }
    )
  );
  // Refresh Test View command
  testViewItems.push(
    vscode.commands.registerCommand('sfdx.force.test.view.refresh', () => {
      if (languageClientUtils.getStatus().isReady()) {
        return testOutlineProvider.refresh();
      }
    })
  );

  return {
    treeView: testProvider,
    viewItems: vscode.Disposable.from(...testViewItems),
  };
}

export async function deactivate() {
  telemetryService.sendExtensionDeactivationEvent();
}
