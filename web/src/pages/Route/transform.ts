/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { omit, pick, cloneDeep, isEmpty, unset } from 'lodash';

import { transformLableValueToKeyValue } from '@/helpers';
import {
  SCHEME_REWRITE,
  URI_REWRITE_TYPE,
  HOST_REWRITE_TYPE
} from '@/pages/Route/constants';

export const transformProxyRewrite2Plugin = (data: RouteModule.ProxyRewrite): RouteModule.ProxyRewrite => {
  let omitFieldsList: string[] = ['kvHeaders'];
  let headers: Record<string, string> = {};

  if (data.scheme !== 'http' && data.scheme !== 'https') {
    omitFieldsList = [
      ...omitFieldsList,
      'scheme',
    ]
  }

  (data.kvHeaders || []).forEach((kvHeader) => {
    if (kvHeader.key) {
      // support value to be an empty string, which means remove a header
      headers = {
        ...headers,
        [kvHeader.key]: kvHeader.value || '',
      };
    }
  });

  if (!isEmpty(headers)) {
    return omit({
      ...data,
      headers,
    }, omitFieldsList);
  }

  return omit(data, omitFieldsList);
}

const transformProxyRewrite2Formdata = (pluginsData: any) => {
  const proxyRewriteData: RouteModule.ProxyRewrite = {
    scheme: SCHEME_REWRITE.KEEP
  };
  let URIRewriteType = URI_REWRITE_TYPE.KEEP;
  let hostRewriteType = HOST_REWRITE_TYPE.KEEP;

  if (pluginsData) {
    if (pluginsData.regex_uri) {
      URIRewriteType = URI_REWRITE_TYPE.REGEXP
    }

    if (pluginsData.uri && !pluginsData.regex_uri) {
      URIRewriteType = URI_REWRITE_TYPE.STATIC
    }

    if (pluginsData.host) {
      hostRewriteType = HOST_REWRITE_TYPE.REWRITE
    }

    Object.keys(pluginsData).forEach(key => {
      switch (key) {
        case 'scheme':
          proxyRewriteData[key] = pluginsData[key] === SCHEME_REWRITE.HTTP || pluginsData[key] === SCHEME_REWRITE.HTTPS ? pluginsData[key] : SCHEME_REWRITE.KEEP;
          break;
        case 'uri':
        case 'regex_uri':
        case 'host':
          proxyRewriteData[key] = pluginsData[key];
          break;
        case 'headers':
          Object.keys(pluginsData[key]).forEach((headerKey) => {
            proxyRewriteData.kvHeaders = [
              ...(proxyRewriteData.kvHeaders || []),
              {
                key: headerKey,
                value: pluginsData[key][headerKey]
              }
            ]
          })
          break;
        default: break;
      }
    })
  }

  return {
    proxyRewriteData,
    URIRewriteType,
    hostRewriteType,
  }
}

// Transform Route data then sent to API
export const transformStepData = ({
  form1Data,
  form2Data,
  advancedMatchingRules,
  step3Data,
}: RouteModule.RequestData) => {
  const { custom_normal_labels, custom_version_label, service_id = '' } = form1Data;

  let redirect: RouteModule.Redirect = {};
  const proxyRewriteFormData: RouteModule.ProxyRewrite = form1Data.proxyRewrite;
  const proxyRewriteConfig = transformProxyRewrite2Plugin(proxyRewriteFormData);

  const step3DataCloned = cloneDeep(step3Data);
  if (form1Data.redirectOption === 'disabled') {
    step3DataCloned.plugins = omit(step3Data.plugins, ['redirect']);
  } else if (form1Data.redirectOption === 'forceHttps') {
    redirect = { http_to_https: true };
  } else if (form1Data.redirectURI !== '') {
    redirect = {
      ret_code: form1Data.ret_code,
      uri: form1Data.redirectURI,
    };
  }

  const labels: Record<string, string> = {};
  transformLableValueToKeyValue(custom_normal_labels).forEach(({ labelKey, labelValue }) => {
    labels[labelKey] = labelValue;
  });


  if (custom_version_label) {
    labels.API_VERSION = custom_version_label;
  }
  const data: Partial<RouteModule.Body> = {
    ...form1Data,
    labels,
    ...step3DataCloned,
    vars: advancedMatchingRules.map((rule) => {
      const { operator, position, name, value } = rule;
      let key = '';
      switch (position) {
        case 'cookie':
          key = `cookie_${name}`;
          break;
        case 'http':
          key = `http_${name}`;
          break;
        default:
          key = `arg_${name}`;
      }
      return [key, operator, value];
    }),
    // @ts-ignore
    methods: form1Data.methods.includes('ALL') ? [] : form1Data.methods,
    status: Number(form1Data.status),
  };

  if (!isEmpty(proxyRewriteConfig)) {
    if (Object.keys(data.plugins || {}).length === 0) {
      data.plugins = {};
    }
    data.plugins!['proxy-rewrite'] = proxyRewriteConfig;
  } else {
    unset(data.plugins, ['proxy-rewrite']);
  }

  if (Object.keys(redirect).length === 0 || redirect.http_to_https) {
    if (form2Data.upstream_id) {
      data.upstream_id = form2Data.upstream_id;
    } else {
      data.upstream = form2Data;
    }

    if (redirect.http_to_https) {
      if (Object.keys(data.plugins || {}).length === 0) {
        data.plugins = {};
      }
      data.plugins!.redirect = redirect;
    }

    // Remove some of the frontend custom variables
    return omit(data, [
      'custom_version_label',
      'custom_normal_labels',
      'advancedMatchingRules',
      'upstreamHostList',
      'upstreamPath',
      'timeout',
      'redirectURI',
      'ret_code',
      'redirectOption',
      'URIRewriteType',
      'hostRewriteType',
      'proxyRewrite',
      service_id.length === 0 ? 'service_id' : '',
      form2Data.upstream_id === 'None' ? 'upstream_id' : '',
      !Object.keys(data.plugins || {}).length ? 'plugins' : '',
      !Object.keys(data.script || {}).length ? 'script' : '',
      form1Data.hosts.filter(Boolean).length === 0 ? 'hosts' : '',
      form1Data.redirectOption === 'disabled' ? 'redirect' : '',
      data.remote_addrs?.filter(Boolean).length === 0 ? 'remote_addrs' : '',
      step3DataCloned.plugin_config_id === '' ? 'plugin_config_id' : ''
    ]);
  }

  if (Object.keys(redirect).length) {
    data.plugins = {
      ...data.plugins,
      redirect,
    };
  }

  return pick(data, [
    'name',
    'desc',
    'uris',
    'methods',
    'redirect',
    'vars',
    'plugins',
    'labels',
    service_id.length !== 0 ? 'service_id' : '',
    form1Data.hosts.filter(Boolean).length !== 0 ? 'hosts' : '',
    data.remote_addrs?.filter(Boolean).length !== 0 ? 'remote_addrs' : '',
  ]);
};

const transformVarsToRules = (
  data: [string, RouteModule.Operator, string][] = [],
): RouteModule.MatchingRule[] =>
  data.map(([key, operator, value]) => {
    const [, position, name] = key.split(/^(cookie|http|arg)_/);
    return {
      position: position as RouteModule.VarPosition,
      name,
      value,
      operator,
      key: Math.random().toString(36).slice(2),
    };
  });

export const transformUpstreamNodes = (
  nodes: Record<string, number> = {},
): RouteModule.UpstreamHost[] => {
  const data: RouteModule.UpstreamHost[] = [];
  Object.entries(nodes).forEach(([k, v]) => {
    const [host, port] = k.split(':');
    data.push({ host, port: Number(port), weight: Number(v) });
  });
  if (data.length === 0) {
    data.push({} as RouteModule.UpstreamHost);
  }
  return data;
};

// Transform response's data
export const transformRouteData = (data: RouteModule.Body) => {
  const {
    name,
    desc,
    labels = {},
    methods = [],
    uris,
    uri,
    hosts,
    host,
    remote_addrs,
    vars,
    status,
    upstream,
    upstream_id,
    service_id = '',
    priority = 0,
    enable_websocket,
  } = data;

  const form1Data: Partial<RouteModule.Form1Data> = {
    name,
    desc,
    status,
    hosts: hosts || (host && [host]) || [''],
    uris: uris || (uri && [uri]) || [],
    remote_addrs: remote_addrs || [''],
    // NOTE: API_VERSION is a system label
    custom_version_label: labels.API_VERSION || '',
    custom_normal_labels: Object.keys(labels)
      .filter((item) => item !== 'API_VERSION')
      .map((key) => `${key}:${labels[key]}`),
    // @ts-ignore
    methods: methods.length ? methods : ['ALL'],
    priority,
    enable_websocket,
    service_id,
  };

  const redirect = data.plugins?.redirect || {};
  if (redirect?.http_to_https) {
    form1Data.redirectOption = 'forceHttps';
  } else if (redirect?.uri) {
    form1Data.redirectOption = 'customRedirect';
    form1Data.ret_code = redirect?.ret_code;
    form1Data.redirectURI = redirect?.uri;
  } else {
    form1Data.redirectOption = 'disabled';
  }

  const proxyRewrite = data.plugins ? data.plugins['proxy-rewrite'] : {};
  const { proxyRewriteData, URIRewriteType, hostRewriteType } = transformProxyRewrite2Formdata(proxyRewrite);
  form1Data.proxyRewrite = proxyRewriteData;
  form1Data.URIRewriteType = URIRewriteType;
  form1Data.hostRewriteType = hostRewriteType;


  const advancedMatchingRules: RouteModule.MatchingRule[] = transformVarsToRules(vars);

  if (upstream && Object.keys(upstream).length) {
    upstream.upstream_id = '';
  }

  const form2Data: RouteModule.Form2Data = upstream || { upstream_id };

  const { plugins, script, plugin_config_id = '' } = data;

  const step3Data: RouteModule.Step3Data = {
    plugins,
    script,
    plugin_config_id,
  };

  return {
    form1Data,
    form2Data,
    step3Data,
    advancedMatchingRules,
  };
};

export const transformLabelList = (data: ResponseLabelList) => {
  if (!data) {
    return {};
  }
  const transformData = {};
  data.forEach((item) => {
    const key = Object.keys(item)[0];
    const value = item[key];
    if (!transformData[key]) {
      transformData[key] = [];
      transformData[key].push(value);
      return;
    }

    if (transformData[key] && !transformData[key][value]) {
      transformData[key].push(value);
    }
  });
  return transformData;
};
