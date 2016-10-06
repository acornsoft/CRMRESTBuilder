var XrmSvcToolkit = (function (window, undefined) {
    /**
    * XrmSvcToolkit v0.2, a small JavaScript library that helps access 
    * Microsoft Dynamics CRM 2011 web service interfaces (SOAP and REST)
    *
    * @copyright    Copyright (c) 2011 - 2013, KingswaySoft (http://www.kingswaysoft.com)
    * @license      Microsoft Public License (Ms-PL)
    * @developer    Daniel Cai (http://danielcai.blogspot.com)
    * @contributors George Doubinski, Mitch Milam, Carsten Groth
    *
    * THIS SOFTWARE IS PROVIDED BY KingswaySoft ''AS IS'' AND ANY
    * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
    * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    * DISCLAIMED. IN NO EVENT SHALL KingswaySoft BE LIABLE FOR ANY
    * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
    * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
    * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
    * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
    * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
    *
    */

    var odataEndpoint = "/XRMServices/2011/OrganizationData.svc",
        soapEndpoint = "/XRMServices/2011/Organization.svc/web";

    // Type sniffering
    var toString = Object.prototype.toString,
        isFunction = function (o) {
            return toString.call(o) === "[object Function]";
        },
        isInteger = function (o) {
            return !isNaN(parseInt(o));
        },
        isString = function (o) {
            return toString.call(o) === "[object String]";
        },
        isArray = function (o) {
            return toString.call(o) === "[object Array]";
        },
        isNonEmptyString = function (o) {
            if (!isString(o) || o.length === 0) {
                return false;
            }

            // checks for a non-white space character 
            return /[^\s]+/.test(o);
        };

    var isoDateExpr = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.?(\d*)?(Z|[+-]\d{2}?(:\d{2})?)?$/,
        jsonDateExpr = /^\/Date\(([-+]?\d+)\)\/$/;

    var context = (function () {
        if (isFunction(window.GetGlobalContext)) {
            return GetGlobalContext();
        } else if (Xrm != undefined) {
            return Xrm.Page.context;
        } else {
            throw new Error("CRM context is not available.");
        }
    })();

    var clientUrl = (function () {
        if (context.getClientUrl !== undefined) {
            return context.getClientUrl();
        }

        var localServerUrl = window.location.protocol + "//" + window.location.host;
        if (context.isOutlookClient() && !context.isOutlookOnline()) {
            return localServerUrl;
        } else {
            var crmServerUrl = context.getServerUrl();
            crmServerUrl = crmServerUrl.replace(/^(http|https):\/\/([_a-zA-Z0-9\-\.]+)(:([0-9]{1,5}))?/, localServerUrl);
            crmServerUrl = crmServerUrl.replace(/\/$/, "");
        }

        return crmServerUrl;
    })();

    var restErrorHandler = function (req) {
        var errorMessage;

        try {
            errorMessage = JSON.parse(req.responseText).error.message.value;
        } catch (err) {
            // Ignore any error when parsing the error message. 
            errorMessage = req.responseText;
        }

        errorMessage = errorMessage.length > 0
            ? "Error: " + req.status + ": " + req.statusText + ": " + errorMessage
            : "Error: " + req.status + ": " + req.statusText;

        return new Error(errorMessage);
    };

    var soapErrorHandler = function (req) {
        var errorMessage = req.responseText.length > 0
            ? "Error: " + req.status + ": " + req.statusText + ": " + req.responseText
            : "Error: " + req.status + ": " + req.statusText;

        return new Error(errorMessage);
    };

    var dateReviver = function (key, value) {
        if (typeof value === 'string') {
            if (value.match(jsonDateExpr)) {
                var dateValue = value.replace(jsonDateExpr, "$1");
                return new Date(parseInt(dateValue, 10));
            }
        }
        return value;
    };

    var xmlEncode = function (input) {
        if (input == null) {
            return null;
        }

        if (input == '') {
            return '';
        }

        var c;
        var result = '';

        for (var pos = 0; pos < input.length; pos++) {
            c = input.charCodeAt(pos);

            if ((c > 96 && c < 123) ||
                (c > 64 && c < 91) ||
                (c > 47 && c < 58) ||
                (c == 32) ||
                (c == 44) ||
                (c == 46) ||
                (c == 45) ||
                (c == 95)) {
                result = result + String.fromCharCode(c);
            } else {
                result = result + '&#' + c + ';';
            }
        }

        return result;
    };

    var parseIsoDate = function (s) {
        if (s == null || !s.match(isoDateExpr))
            return null;

        var dateParts = isoDateExpr.exec(s);
        return new Date(Date.UTC(parseInt(dateParts[1], 10),
            parseInt(dateParts[2], 10) - 1,
            parseInt(dateParts[3], 10),
            parseInt(dateParts[4], 10) - (dateParts[8] == "" || dateParts[8] == "Z" ? 0 : parseInt(dateParts[8])),
            parseInt(dateParts[5], 10),
            parseInt(dateParts[6], 10)));
    };

    var getAttribute = function (xmlNode, attrName) {
        for (var i = 0; i < xmlNode.attributes.length; i++) {
            var attr = xmlNode.attributes[i];
            if (attr.name == attrName) {
                return attr.value;
            }
        }
    };

    var getNodeText = function (node) {
        return node.text !== undefined
            ? node.text
            : node.textContent;
    }

    var getTypedValue = function (fieldType, valueNode) {
        switch (fieldType) {
            case "c:string":
            case "c:guid":
                return getNodeText(valueNode);
            case "c:boolean":
                return getNodeText(valueNode) === "true";
            case "c:int":
                return parseInt(getNodeText(valueNode));
            case "c:decimal":
            case "c:double":
                return parseFloat(getNodeText(valueNode));
            case "c:dateTime":
                return parseIsoDate(getNodeText(valueNode));
            case "a:OptionSetValue":
                valueNode = getChildNode(valueNode, "a:Value");
                return {
                    Value: parseInt(getNodeText(valueNode))
                };
            case "a:Money":
                valueNode = getChildNode(valueNode, "a:Value");
                return {
                    Value: getNodeText(valueNode)
                };
            case "a:EntityReference":
                return getEntityReference(valueNode);
            case "a:EntityCollection":
                return getEntityCollection(valueNode);
            case "a:AliasedValue":
                valueNode = getChildNode(valueNode, "a:Value");
                fieldType = getAttribute(valueNode, "i:type");
                return getTypedValue(fieldType, valueNode);

            default:
                throw new Error("Unhandled field type: \"" + fieldType + "\", please report the problem to the developer. ");
        }
    };

    var concatOdataFields = function (fields, parameterName) {
        if (isArray(fields) && fields.length > 0) {
            return fields.join(',');
        } else if (isString(fields)) {
            return fields;
        }
        else if (parameterName != undefined) {
            throw new Error(parameterName + " parameter must be either a delimited string or an array. ");
        }
        else {
            return "";
        }
    };

    // Get a list of entities from an EntityCollection XML node.
    var getEntityCollection = function (entityCollectionNode) {
        var entityName, moreRecords, pagingCookie, totalRecordCount, entitiesNode;

        // Try to get all child nodes in one pass
        for (var m = 0; m < entityCollectionNode.childNodes.length; m++) {
            var collectionChildNode = entityCollectionNode.childNodes[m];
            switch (collectionChildNode.nodeName) {
                case "a:EntityName":
                    entityName = getNodeText(collectionChildNode);
                    break;
                case "a:MoreRecords":
                    moreRecords = getNodeText(collectionChildNode) === "true";
                    break;
                case "a:PagingCookie":
                    pagingCookie = getNodeText(collectionChildNode);
                    break;
                case "a:TotalRecordCount":
                    totalRecordCount = parseInt(getNodeText(collectionChildNode));
                    break;
                case "a:Entities":
                    entitiesNode = collectionChildNode;
                    break;
            }
        }

        var result = {
            entityName: entityName,
            moreRecords: moreRecords,
            pagingCookie: pagingCookie,
            totalRecordCount: totalRecordCount,
            entities: []
        };

        for (var i = 0; i < entitiesNode.childNodes.length; i++) {
            var entity = { formattedValues: [] };
            var entityNode = entitiesNode.childNodes[i];
            var attributes = getChildNode(entityNode, "a:Attributes");
            for (var j = 0; j < attributes.childNodes.length; j++) {
                var attr = attributes.childNodes[j];

                var fieldName = getNodeText(getChildNode(attr, "b:key"));
                var valueNode = getChildNode(attr, "b:value");
                var fieldType = getAttribute(valueNode, "i:type");

                entity[fieldName] = getTypedValue(fieldType, valueNode);
            }

            var formattedValues = getChildNode(entityNode, "a:FormattedValues");

            for (var k = 0; k < formattedValues.childNodes.length; k++) {
                var valuePair = formattedValues.childNodes[k];
                entity.formattedValues[getNodeText(getChildNode(valuePair, "b:key"))] = getNodeText(getChildNode(valuePair, "b:value"));
            }

            result.entities.push(entity);
        }

        return result;
    };

    // Get an EntityReference from an XML node. For performance reason, we try to
    // get the entity reference in one pass, instead of multiple.
    var getEntityReference = function (xmlNode) {
        var id, logicalName, name;
        for (var i = 0; i < xmlNode.childNodes.length; i++) {
            var childNode = xmlNode.childNodes[i];

            switch (childNode.nodeName) {
                case "a:Id":
                    id = getNodeText(childNode);
                    break;
                case "a:LogicalName":
                    logicalName = getNodeText(childNode);
                    break;
                case "a:Name":
                    name = getNodeText(childNode);
                    break;
            }
        }

        return {
            Id: id,
            LogicalName: logicalName,
            Name: name
        };
    }

    // Get a single child node that matches the specified name.
    var getChildNode = function (xmlNode, nodeName) {
        for (var i = 0; i < xmlNode.childNodes.length; i++) {
            var childNode = xmlNode.childNodes[i];

            if (childNode.nodeName == nodeName) {
                return childNode;
            }
        }
    }

    var getSoapError = function (soapXml) {
        try {
            var bodyNode = soapXml.firstChild.firstChild;
            var faultNode = getChildNode(bodyNode, "s:Fault");
            var faultStringNode = getChildNode(faultNode, "faultstring");
            return new Error(getNodeText(faultStringNode));
        }
        catch (e) {
            return new Error("An error occurred when parsing the error returned from CRM server: " + e.message);
        }
    }

    var processSoapResponse = function (responseXml, successCallback, errorCallback) {
        try {
            var executeResult = responseXml.firstChild.firstChild.firstChild.firstChild; // "s:Envelope/s:Body/ExecuteResponse/ExecuteResult"
        } catch (err) {
            errorCallback(err);
            return;
        }

        return successCallback(executeResult);
    };

    var getFetchResults = function (resultXml) {
        // For simplicity reason, we are assuming the returned SOAP message uses the following three namespace aliases
        //   xmlns:a="http://schemas.microsoft.com/xrm/2011/Contracts"
        //   xmlns:i="http://www.w3.org/2001/XMLSchema-instance"
        //   xmlns:b="http://schemas.datacontract.org/2004/07/System.Collections.Generic"
        // however it is possible that the namespace aliases returned from CRM server could be different, in which
        // case, the fetch function will not work properly
        // For future reference, XPath to the entity collection node:
        // a:Results/a:KeyValuePairOfstringanyType/b:value[@i:type='a:EntityCollection']
        var resultsNode = getChildNode(resultXml, "a:Results"); // a:Results
        var entityCollectionNode = getChildNode(resultsNode.firstChild, "b:value"); // b:value
        return getEntityCollection(entityCollectionNode);
    };

    var processRestResult = function (req, successCallback, errorCallback) {
        if ((req.status >= 200 && req.status < 300) || req.status === 304 || req.status === 1223) {
            try {
                var result = (!!req.responseText)
							? JSON.parse(req.responseText, dateReviver).d
							: null;
            } catch (err) {
                errorCallback(err);
                return;
            }

            return successCallback(result);

        } else {
            errorCallback(restErrorHandler(req));
        }
    };

    var doRestRequest = function (restReq, successCallback, errorCallback) {
        var req = new XMLHttpRequest();
        req.open(restReq.type, restReq.url, restReq.async);
        req.setRequestHeader("Accept", "application/json");
        req.setRequestHeader("Content-Type", "application/json; charset=utf-8");
        if (!!restReq.method) {
            req.setRequestHeader("X-HTTP-Method", restReq.method);
        }

        var erred = false;

        if (restReq.async) {
            req.onreadystatechange = function () {
                if (req.readyState == 4 /* complete */) {
                    processRestResult(req, successCallback, errorCallback);
                }
            };

            if (!!restReq.data) {
                req.send(restReq.data);
            } else {
                req.send();
            }
        } else {
            try {
                //synchronous: send request, then call the callback functions
                if (!!restReq.data) {
                    req.send(restReq.data);
                } else {
                    req.send();
                }

                return processRestResult(req, successCallback, errorCallback);

            } catch (err) {
                errorCallback(err);
            }
        }
    };

    var doSoapRequest = function (soapBody, async, successCallback, errorCallback) {
        var req = new XMLHttpRequest();

        req.open("POST", clientUrl + soapEndpoint, async);
        req.setRequestHeader("Accept", "application/xml, text/xml, */*");
        req.setRequestHeader("Content-Type", "text/xml; charset=utf-8");
        req.setRequestHeader("SOAPAction", "http://schemas.microsoft.com/xrm/2011/Contracts/Services/IOrganizationService/Execute");

        var soapXml = [
'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>',
    soapBody,
'</s:Body></s:Envelope>'].join('');

        if (async) {
            req.onreadystatechange = function () {
                if (req.readyState == 4) { // "complete"
                    if (req.status == 200) { // "OK"
                        processSoapResponse(req.responseXML, successCallback, errorCallback);
                    } else {
                        errorCallback(soapErrorHandler(req));
                    }
                }
            };

            req.send(soapXml);
        } else {
            var syncResult;
            try {
                //synchronous: send request, then call the callback function directly
                req.send(soapXml);
                if (req.status == 200) {
                    return processSoapResponse(req.responseXML, successCallback, errorCallback);
                }
                else {
                    var syncErr = getSoapError(req.responseXML);
                    errorCallback(syncErr);
                    return;
                }
            } catch (err) {
                errorCallback(err);
                return;
            }

            successCallback(syncResult);
        }
    };

    var execute = function (opts) {

        if (!isNonEmptyString(opts.executeXml)) {
            throw new Error("executeXml parameter was not provided. ");
        }

        var async = !!opts.async;

        return doSoapRequest(opts.executeXml, async, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            }
            else {
                throw err;
            }
        });
    };

    var setState = function (opts) {

        if (!isNonEmptyString(opts.id)) {
            throw new Error("id parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.entityName)) {
            throw new Error("entityName parameter was not provided. ");
        }

        if (!isInteger(opts.stateCode)) {
            throw new Error("stateCode parameter must be an integer. ");
        }

        if (opts.statusCode == null) {
            opts.statusCode = -1;
        }

        var request = [
'<Execute xmlns="http://schemas.microsoft.com/xrm/2011/Contracts/Services">',
    '<request i:type="b:SetStateRequest"',
            ' xmlns:a="http://schemas.microsoft.com/xrm/2011/Contracts" ',
            ' xmlns:b="http://schemas.microsoft.com/crm/2011/Contracts" ',
            ' xmlns:c="http://schemas.datacontract.org/2004/07/System.Collections.Generic" ',
            ' xmlns:i="http://www.w3.org/2001/XMLSchema-instance">',
        '<a:Parameters>',
            '<a:KeyValuePairOfstringanyType>',
                '<c:key>EntityMoniker</c:key>',
                '<c:value i:type="a:EntityReference">',
                    '<a:Id>', opts.id, '</a:Id>',
                    '<a:LogicalName>', opts.entityName, '</a:LogicalName>',
                    '<a:Name i:nil="true" />',
                '</c:value>',
            '</a:KeyValuePairOfstringanyType>',
            '<a:KeyValuePairOfstringanyType>',
                '<c:key>State</c:key>',
                '<c:value i:type="a:OptionSetValue">',
                    '<a:Value>', opts.stateCode, '</a:Value>',
                '</c:value>',
            '</a:KeyValuePairOfstringanyType>',
            '<a:KeyValuePairOfstringanyType>',
                '<c:key>Status</c:key>',
                '<c:value i:type="a:OptionSetValue">',
                    '<a:Value>', opts.statusCode, '</a:Value>',
                '</c:value>',
            '</a:KeyValuePairOfstringanyType>',
        '</a:Parameters>',
        '<a:RequestId i:nil="true"/>',
        '<a:RequestName>SetState</a:RequestName>',
    '</request>',
'</Execute>'].join("");

        var async = !!opts.async;

        return doSoapRequest(request, async, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            }
            else {
                throw err;
            }
        });
    };

    var fetch = function (opts) {
        if (!isNonEmptyString(opts.fetchXml)) {
            throw new Error("fetchXml parameter was not provided. ");
        }

        var request = [
'<Execute xmlns="http://schemas.microsoft.com/xrm/2011/Contracts/Services">',
    '<request i:type="a:RetrieveMultipleRequest"',
            ' xmlns:a="http://schemas.microsoft.com/xrm/2011/Contracts" ',
            ' xmlns:i="http://www.w3.org/2001/XMLSchema-instance">',
        '<a:Parameters xmlns:c="http://schemas.datacontract.org/2004/07/System.Collections.Generic">',
            '<a:KeyValuePairOfstringanyType>',
                '<c:key>Query</c:key>',
                '<c:value i:type="a:FetchExpression">',
                    '<a:Query>', xmlEncode(opts.fetchXml), '</a:Query>',
                '</c:value>',
            '</a:KeyValuePairOfstringanyType>',
        '</a:Parameters>',
        '<a:RequestId i:nil="true"/>',
        '<a:RequestName>RetrieveMultiple</a:RequestName>',
    '</request>',
'</Execute>'].join("");

        var async = !!opts.async;

        return doSoapRequest(request, async, function (result) {
            var fetchResults = getFetchResults(result);

            if (isFunction(opts.successCallback)) {
                opts.successCallback(fetchResults);
            }

            if (!async) {
                return fetchResults;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            }
            else {
                throw err;
            }
        });
    };

    var retrieve = function (opts) {
        if (!isNonEmptyString(opts.entityName)) {
            throw new Error("entityName parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.id)) {
            throw new Error("id parameter was not provided. ");
        }

        var select = opts.select == null
            ? ""
            : concatOdataFields(opts.select, "select");

        var expand = opts.expand == null
            ? ""
            : concatOdataFields(opts.expand, "expand");

        var odataQuery = "";

        if (select.length > 0 || expand.length > 0) {
            odataQuery = "?";
            if (select.length > 0) {
                odataQuery += "$select=" + select;

                if (expand.length > 0) {
                    odataQuery += "&";
                }
            }

            if (expand.length > 0) {
                odataQuery += "$expand=" + expand;
            }
        }

        var restReq = {
            url: clientUrl + odataEndpoint + "/" + opts.entityName + "Set(guid'" + opts.id + "')" + odataQuery,
            type: "GET",
            async: !!opts.async
        };

        return doRestRequest(restReq, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!opts.async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            } else {
                throw err;
            }
        });
    };

    var retrieveMultiple = function (opts) {
        if (!isNonEmptyString(opts.entityName)) {
            throw new Error("entityName parameter was not provided. ");
        }

        var odataQuery = "";
        if (opts.odataQuery != null) {
            if (!isString(opts.odataQuery)) {
                throw new Error("odataQuery parameter must be a string. ");
            }

            if (opts.odataQuery.charAt(0) != "?") {
                odataQuery = "?" + opts.odataQuery;
            } else {
                odataQuery = opts.odataQuery;
            }
        }

        var restReq = {
            url: clientUrl + odataEndpoint + "/" + opts.entityName + "Set" + odataQuery,
            type: "GET",
            async: !!opts.async
        };

        return doRestRequest(restReq, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result.results);
            }

            if (!opts.async) {
                return result.results;
            }

            if (result.__next != null) {
                opts.odataQuery = result.__next.substring((clientUrl + odataEndpoint + "/" + opts.entityName + "Set").length);
                retrieveMultiple(opts);
            } else {
                if (isFunction(opts.completionCallback)) {
                    opts.completionCallback();
                }
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            } else {
                throw err;
            }
        });
    };

    var createRecord = function (opts) {
        if (!isNonEmptyString(opts.entityName)) {
            throw new Error("entityName parameter was not provided. ");
        }

        if (opts.entity === null || opts.entity === undefined) {
            throw new Error("entity parameter was not provided. ");
        }

        var restReq = {
            url: clientUrl + odataEndpoint + "/" + opts.entityName + 'Set',
            type: "POST",
            data: window.JSON.stringify(opts.entity),
            async: !!opts.async
        };

        return doRestRequest(restReq, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!opts.async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            } else {
                throw err;
            }
        });
    };

    var updateRecord = function (opts) {
        if (!isNonEmptyString(opts.entityName)) {
            throw new Error("entityName parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.id)) {
            throw new Error("id parameter was not provided. ");
        }

        if (opts.entity === null || opts.entity === undefined) {
            throw new Error("entity parameter was not provided. ");
        }

        var restReq = {
            url: clientUrl + odataEndpoint + "/" + opts.entityName + "Set(guid'" + opts.id + "')",
            type: "POST",
            method: "MERGE",
            data: window.JSON.stringify(opts.entity),
            async: !!opts.async
        };

        return doRestRequest(restReq, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!opts.async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            } else {
                throw err;
            }
        });
    };

    var deleteRecord = function (opts) {

        if (!isNonEmptyString(opts.entityName)) {
            throw new Error("entityName parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.id)) {
            throw new Error("id parameter was not provided. ");
        }

        var restReq = {
            url: clientUrl + odataEndpoint + "/" + opts.entityName + "Set(guid'" + opts.id + "')",
            type: "POST",
            method: "DELETE",
            async: !!opts.async
        };

        return doRestRequest(restReq, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!opts.async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            }
            else {
                throw err;
            }
        });
    };

    var associate = function (opts) {

        if (!isNonEmptyString(opts.entity1Id)) {
            throw new Error("entity1Id parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.entity1Name)) {
            throw new Error("entity1Name parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.entity2Id)) {
            throw new Error("entity2Id parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.entity2Name)) {
            throw new Error("entity2Name parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.relationshipName)) {
            throw new Error("relationshipName parameter was not provided. ");
        }

        var entity2Uri = {
            uri: clientUrl + odataEndpoint + "/" + opts.entity2Name + "Set(guid'" + opts.entity2Id + "')"
        };

        var restReq = {
            url: clientUrl + odataEndpoint + "/" + opts.entity1Name + "Set(guid'" + opts.entity1Id + "')/$links/" + opts.relationshipName,
            type: "POST",
            data: window.JSON.stringify(entity2Uri),
            async: !!opts.async
        };

        return doRestRequest(restReq, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!opts.async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            } else {
                throw err;
            }
        });
    };

    var disassociate = function (opts) {

        if (!isNonEmptyString(opts.entity1Id)) {
            throw new Error("entity1Id parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.entity1Name)) {
            throw new Error("entity1Name parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.entity2Id)) {
            throw new Error("entity2Id parameter was not provided. ");
        }

        if (!isNonEmptyString(opts.relationshipName)) {
            throw new Error("relationshipName parameter was not provided. ");
        }

        var restReq = {
            url: clientUrl + odataEndpoint + "/" + opts.entity1Name + "Set(guid'" + opts.entity1Id + "')/$links/" + opts.relationshipName + "(guid'" + opts.entity2Id + "')",
            type: "POST",
            method: "DELETE",
            async: !!opts.async
        };

        return doRestRequest(restReq, function (result) {
            if (isFunction(opts.successCallback)) {
                opts.successCallback(result);
            }

            if (!opts.async) {
                return result;
            }
        }, function (err) {
            if (isFunction(opts.errorCallback)) {
                opts.errorCallback(err);
            } else {
                throw err;
            }
        });
    };

    // Toolkit's public members
    return {
        context: context,
        serverUrl: clientUrl,
        retrieve: retrieve,
        retrieveMultiple: retrieveMultiple,
        createRecord: createRecord,
        updateRecord: updateRecord,
        deleteRecord: deleteRecord,
        associate: associate,
        disassociate: disassociate,
        setState: setState,
        execute: execute,
        fetch: fetch
    };
})(window);