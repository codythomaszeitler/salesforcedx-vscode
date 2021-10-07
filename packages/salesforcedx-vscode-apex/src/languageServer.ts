/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  Executable,
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn
} from 'vscode-languageclient';
import { LSP_ERR } from './constants';
import { soqlMiddleware } from './embeddedSoql';
import { nls } from './messages';
import * as requirements from './requirements';
import { telemetryService } from './telemetry';

const UBER_JAR_NAME = 'apex-jorje-lsp.jar';
const JDWP_DEBUG_PORT = 2739;
const APEX_LANGUAGE_SERVER_MAIN = 'apex.jorje.lsp.ApexLanguageServerLauncher';

declare var v8debug: any;
const DEBUG = typeof v8debug === 'object' || startedInDebugMode();

async function createServer(
  context: vscode.ExtensionContext
): Promise<Executable> {
  try {
    deleteDbIfExists();
    const requirementsData = await requirements.resolveRequirements();
    const uberJar = path.resolve(context.extensionPath, 'out', UBER_JAR_NAME);
    const javaExecutable = path.resolve(
      `${requirementsData.java_home}/bin/java`
    );
    const jvmMaxHeap = requirementsData.java_memory;
    const enableSemanticErrors: boolean = vscode.workspace
      .getConfiguration()
      .get<boolean>('salesforcedx-vscode-apex.enable-semantic-errors', false);
    const enableCompletionStatistics: boolean = vscode.workspace
      .getConfiguration()
      .get<boolean>(
        'salesforcedx-vscode-apex.advanced.enable-completion-statistics',
        false
      );

    const args: string[] = [
      '-cp',
      uberJar,
      '-Ddebug.internal.errors=true',
      `-Ddebug.semantic.errors=${enableSemanticErrors}`,
      `-Ddebug.completion.statistics=${enableCompletionStatistics}`,
      '-Dlwc.typegeneration.disabled=true'
    ];

    if (jvmMaxHeap) {
      args.push(`-Xmx${jvmMaxHeap}M`);
    }

    // if (DEBUG) {
    //   args.push(
    //     '-Dtrace.protocol=false',
    //     `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${JDWP_DEBUG_PORT},quiet=y`
    //   );
    //   if (process.env.YOURKIT_PROFILER_AGENT) {
    //     args.push(`-agentpath:${process.env.YOURKIT_PROFILER_AGENT}`);
    //   }
    // }

    args.push(APEX_LANGUAGE_SERVER_MAIN);
    return {
      options: {
        env: process.env,
        stdio: 'pipe'
      },
      // ******* Java jar
      // command: javaExecutable,
      // args

      // ******* Native image agentlib:
      // command:
      //   '/Users/fernandodobladez/.asdf/installs/java/graalvm-21.0.0.2+java8/bin/java',
      //   args: [
      //     '-agentlib:native-image-agent=config-merge-dir=/Users/fernandodobladez/graal-native-image-test/META-INF/native-image/',
      //     '-cp',
      //     '/Users/fernandodobladez/graal-native-image-test/apex-jorje-lsp-236.0-SNAPSHOT.jar',

      //     '-Ddebug.internal.errors=true',
      //     `-Ddebug.semantic.errors=${enableSemanticErrors}`,
      //     `-Ddebug.completion.statistics=${enableCompletionStatistics}`,
      //     '-Dlwc.typegeneration.disabled=true',
      //       'apex.jorje.lsp.ApexLanguageServerLauncher'
      //   ]

      // ******* AOT-compiled, native binary
      command: path.resolve(
        context.extensionPath,
        'out',
        'apex.jorje.lsp.apexlanguageserverlauncher'
      ),
      args: [
        `-DstandardApexLibraryPath=${path.resolve(
          context.extensionPath,
          'out',
          'StandardApexLibrary'
        )}`,
        '-Ddebug.internal.errors=true',
        `-Ddebug.semantic.errors=${enableSemanticErrors}`,
        `-Ddebug.completion.statistics=${enableCompletionStatistics}`,
        '-Dlwc.typegeneration.disabled=true'
      ]
    };
  } catch (err) {
    vscode.window.showErrorMessage(err);
    telemetryService.sendException(LSP_ERR, err.error);
    throw err;
  }
}

function deleteDbIfExists(): void {
  if (
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders[0]
  ) {
    const dbPath = path.join(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      '.sfdx',
      'tools',
      'apex.db'
    );
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
}

function startedInDebugMode(): boolean {
  const args = (process as any).execArgv;
  console.log(
    '************************ startedInDebugMode args: ' + JSON.stringify(args)
  );
  if (args) {
    return args.some(
      (arg: any) =>
        /^--debug=?/.test(arg) ||
        /^--debug-brk=?/.test(arg) ||
        /^--inspect=?/.test(arg) ||
        /^--inspect-brk=?/.test(arg)
    );
  }
  return false;
}

// See https://github.com/Microsoft/vscode-languageserver-node/issues/105
export function code2ProtocolConverter(value: vscode.Uri) {
  if (/^win32/.test(process.platform)) {
    // The *first* : is also being encoded which is not the standard for URI on Windows
    // Here we transform it back to the standard way
    return value.toString().replace('%3A', ':');
  } else {
    return value.toString();
  }
}

function protocol2CodeConverter(value: string) {
  return vscode.Uri.parse(value);
}

export async function createLanguageServer(
  context: vscode.ExtensionContext
): Promise<LanguageClient> {
  const server = await createServer(context);
  const client = new LanguageClient(
    'apex',
    nls.localize('client_name'),
    server,
    buildClientOptions()
  );

  client.onTelemetry(data =>
    telemetryService.sendEventData('apexLSPLog', data.properties, data.measures)
  );

  console.log(
    '======= createLanguageServer(): timestamp: ' + new Date().getTime()
  );
  return client;
}

// exported only for testing
export function buildClientOptions(): LanguageClientOptions {
  const soqlExtensionInstalled = isSOQLExtensionInstalled();

  return {
    // Register the server for Apex documents
    documentSelector: [{ language: 'apex', scheme: 'file' }],
    synchronize: {
      configurationSection: 'apex',
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.cls'), // Apex classes
        vscode.workspace.createFileSystemWatcher('**/*.trigger'), // Apex triggers
        vscode.workspace.createFileSystemWatcher('**/sfdx-project.json') // SFDX workspace configuration file
      ]
    },
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    uriConverters: {
      code2Protocol: code2ProtocolConverter,
      protocol2Code: protocol2CodeConverter
    },
    initializationOptions: {
      enableEmbeddedSoqlCompletion: soqlExtensionInstalled
    },
    ...(soqlExtensionInstalled ? { middleware: soqlMiddleware } : {})
  };
}

function isSOQLExtensionInstalled() {
  const soqlExtensionName = 'salesforce.salesforcedx-vscode-soql';
  const soqlExtension = vscode.extensions.getExtension(soqlExtensionName);
  return soqlExtension !== undefined;
}
