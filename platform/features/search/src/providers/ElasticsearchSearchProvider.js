/*****************************************************************************
 * Open MCT Web, Copyright (c) 2014-2015, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT Web is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT Web includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/
/*global define*/

/**
 * Module defining ElasticsearchSearchProvider. Created by shale on 07/16/2015.
 */
define(
    [],
    function () {
        "use strict";

        // JSLint doesn't like underscore-prefixed properties,
        // so hide them here.
        var ID = "_id",
            SCORE = "_score",
            DEFAULT_MAX_RESULTS = 100;
        
        /**
         * A model service which reads domain object models from an external
         * persistence service.
         *
         * @constructor
         * @param {PersistenceService} persistenceService the service in which
         *        domain object models are persisted.
         * @param $q Angular's $q service, for working with promises
         * @param {string} SPACE the name of the persistence space from which
         *        models should be retrieved.
         */
        function ElasticsearchSearchProvider($http, objectService, ROOT) {
            // TODO: Fix the above docstring 
            var latestSearchResults = [],
                currentResultIndex = 0;
            
            // Check to see if the input has any special options
            function isDefaultFormat(searchTerm) {
                // If the input has a property option, not default
                if (searchTerm.includes('name:') || searchTerm.includes('type:')) {
                    return false;
                }
                
                return true;
            }
            
            // Add the fuzziness operator to the search term 
            function addFuzziness(searchTerm, editDistance) {
                if (!editDistance) {
                    editDistance = '';
                }
                
                return searchTerm.split(' ').map(function (s) {
                    if (s.includes('"')) {
                        return s;
                    } else {
                        return s + '~' + editDistance;
                    }
                }).join(' ');
            }
            
            // Currently specific to elasticsearch
            function processSearchTerm(searchTerm) {
                // Shave any spaces off of the ends of the input
                while (searchTerm.substr(0, 1) === ' ') {
                    searchTerm = searchTerm.substring(1, searchTerm.length);
                }
                while (searchTerm.substr(searchTerm.length - 1, 1) === ' ') {
                    searchTerm = searchTerm.substring(0, searchTerm.length - 1);
                }
                
                if (isDefaultFormat(searchTerm)) {
                    // Add fuzziness for completeness
                    searchTerm = addFuzziness(searchTerm);
                    
                    // Searching 'name' by default
                    searchTerm = 'name:' + searchTerm;
                }
                
                //console.log('search term ', searchTerm);
                return searchTerm;
            }
            
            // Get the next search result 
            function next() {
                // Because elasticsearch only returns matching things, we just 
                // need to step through the array
                
                currentResultIndex++;
                
                if (currentResultIndex > latestSearchResults.length) {
                    // If we go past the end of the array, we return undefined
                    return undefined;
                } else {
                    return latestSearchResults[currentResultIndex];
                }
            }
            
            function first() {
                // Since next() immeditely does 'i++', start before the start of the array
                currentResultIndex = -1;
                var n = next();
                return n;
            }
            
            // Processes results from the format that elasticsearch returns to 
            // a list of objects in the format that mct-representation can use
            function processResults(rawResults, validType) {
                var results = rawResults.data.hits.hits,
                    resultsLength = results.length,
                    ids = [],
                    scores = {},
                    searchResults = [];
                
                if (rawResults.data.hits.total > resultsLength) {
                    // TODO: Somehow communicate this to the user 
                    console.log('Total number of results greater than displayed results');
                }
                
                // Get the result objects' IDs
                for (var i = 0; i < resultsLength; i += 1) {
                    ids.push(results[i][ID]);
                }
                
                // Get the result objects' scores
                for (var i = 0; i < resultsLength; i += 1) {
                    scores[ ids[i] ] = results[i][SCORE];
                }
                
                // Get the domain objects from their IDs
                return objectService.getObjects(ids).then(function (objects) {
                    
                    // Filter by search term
                    for (var j = 0; j < resultsLength; j += 1) {
                        var id = ids[j];
                        
                        // Include items we can get models for
                        if (objects[id].getModel) {
                            // Check to see if they are allowed to be included 
                            if (validType(objects[id].getModel())) {
                                // Format the results as searchResult objects
                                searchResults.push({
                                    id: id,
                                    object: objects[id],
                                    score: scores[id],
                                    next: next
                                });
                            }
                        }
                    }
                    
                    console.log('setting latest search results with', searchResults);
                    latestSearchResults = searchResults;
                    return searchResults;
                });
            }
            
            /**
             * Searches through the filetree for domain objects using a search 
             *   term. This is done through querying elasticsearch. 
             * Notes:
             *   * The order of the results is from highest to lowest score, 
             *     as elsaticsearch determines them to be. 
             *   * Wildcards are supported. 
             *   * Fuzziness is used to produce more results that are still
             *     relevant. (All results within a certain edit distance.)
             *   * More search details at 
             *     https://www.elastic.co/guide/en/elasticsearch/reference/current/search-uri-request.html
             * 
             * @param inputID the name of the ID property of the html text 
             *   input where this funcion should find the search term 
             * @param validType a function which takes a model for an object
             *   and determines if it is of a valid type to include in the 
             *   final list of results
             * @param maxResults (optional) the maximum number of results 
             *   that this function should return 
             * @param timeout (optional) the time after which the search should 
             *   stop calculations and return partial results
             */
            function queryElasticsearch(inputID, validType, maxResults, timeout) {
                var searchTerm,
                    esQuery;
                
                // Check to see if the user provided a maximum 
                // number of results to display
                if (!maxResults) {
                    // Else, we provide a default value. 
                    maxResults = DEFAULT_MAX_RESULTS;
                }
                
                // Get the user input 
                searchTerm = document.getElementById(inputID).value;
                
                // Process search term
                searchTerm = processSearchTerm(searchTerm);
                
                // Create the query to elasticsearch
                esQuery = ROOT + "/_search/?q=" + searchTerm + "&size=" + maxResults;
                if (timeout) {
                    esQuery += "&timeout=" + timeout;
                }
                
                // Get the data...
                return $http({
                    method: "GET",
                    url: esQuery
                }).then(function (rawResults) {
                    // ...then process the data 
                    processResults(rawResults, validType);
                    // and return the first result
                    var f = first();
                    // console.log('ES return', f);
                    return f;
                });
            }
            
            return {
                query: queryElasticsearch
            };
        }


        return ElasticsearchSearchProvider;
    }
);