define( [
            'dojo/_base/declare',
            'dojo/_base/lang',
            'dojo/_base/array',
            'dojo/_base/url',
            'JBrowse/Store/BigWig/Window',
            'dojo/_base/Deferred',
            'JBrowse/Util',
            'JBrowse/Model/XHRBlob'
        ],
        function( declare, lang, array, urlObj, Window, Deferred, Util, XHRBlob ) {
var dlog = function() { console.log.apply( console, arguments ); };

return declare( null,
 /**
  * @lends JBrowse.Store.BigWig
  */
{

    BIG_WIG_MAGIC: -2003829722,
    BIG_BED_MAGIC: -2021002517,

    BIG_WIG_TYPE_GRAPH: 1,
    BIG_WIG_TYPE_VSTEP: 2,
    BIG_WIG_TYPE_FSTEP: 3,

    /**
     * Data backend for reading wiggle data from BigWig or BigBed files.
     *
     * Adapted by Robert Buels from bigwig.js in the Dalliance Genome
     * Explorer which is copyright Thomas Down 2006-2010
     * @constructs
     */
    constructor: function( args ) {

        this.refSeq = args.refSeq;

        var data = args.blob || (function() {
            var url = Util.resolveUrl(
                args.baseUrl || '/',
                Util.fillTemplate( args.urlTemplate || 'data.bigwig',
                                   {'refseq': (this.refSeq||{}).name }
                                 )
            );
            return new XHRBlob( url );
        }).call(this);
        var name = args.name || ( data.url && new urlObj( data.url ).path.replace(/^.+\//,'') ) || 'anonymous';

        var bwg = this;

        bwg._loading = new Deferred();
        if( args.callback )
            bwg._loading.then(
                function() { args.callback(bwg); },
                function(result) { args.callback(null, result.error || 'Loading failed!'); }
            );
        bwg._loading.then( function() {
                               bwg._loading = null;
                           });
        bwg._loading.then(
            dojo.hitch( this, function(result) {
                            if( result.success )
                                this.loadSuccess();
                            else
                                this.loadFail( result.error || 'BigWig loading failed' ) ;
                        })
        );

        bwg.data = data;
        bwg.name = name;
    },

    getGlobalStats: function() {
        var s = this._stats;
        if( !s )
            return {};

        // calc mean and standard deviation if necessary
        if( !( 'scoreMean' in s ))
            s.scoreMean = s.scoreSum / s.basesCovered;
        if( !( 'scoreStdDev' in s ))
            s.scoreStdDev = this._calcStdFromSums( s.scoreSum, s.scoreSumSquares, s.basesCovered );

        return s;
    },

    _calcStdFromSums: function( sum, sumSquares, n ) {
        var variance = sumSquares - sum*sum/n;
        if (n > 1) {
	    variance /= n-1;
        }
        return variance < 0 ? 0 : Math.sqrt(variance);
    },

    whenReady: function() {
        var f = lang.hitch.apply(lang, arguments);
        if( this._loading ) {
            this._loading.then( f );
        } else {
            f();
        }
    },

    load: function() {
        var bwg = this;
        var headerSlice = bwg.data.slice(0, 512);
        headerSlice.fetch( function(result) {
            if (!result) {
                bwg._loading.resolve({ success: false });
                return;
            }

            bwg.fileSize = result.fileSize;
            var header = result;
            var sa = new Int16Array(header);
            var la = new Int32Array(header);
            if (la[0] == bwg.BIG_WIG_MAGIC) {
                bwg.type = 'bigwig';
            } else if (la[0] == bwg.BIG_BED_MAGIC) {
                bwg.type = 'bigbed';
            } else {
                console.error( 'Format '+la[0]+' not supported' );
                bwg._loading.resolve({ success: false });
                return;
            }
            //        dlog('magic okay');

            bwg.version = sa[2];             // 4
            bwg.numZoomLevels = sa[3];       // 6
            bwg.chromTreeOffset = (la[2] << 32) | (la[3]);     // 8
            bwg.unzoomedDataOffset = (la[4] << 32) | (la[5]);  // 16
            bwg.unzoomedIndexOffset = (la[6] << 32) | (la[7]); // 24
            bwg.fieldCount = sa[16];         // 32
            bwg.definedFieldCount = sa[17];  // 34
            bwg.asOffset = (la[9] << 32) | (la[10]);    // 36 (unaligned longlong)
            bwg.totalSummaryOffset = (la[11] << 32) | (la[12]);    // 44 (unaligned longlong)
            bwg.uncompressBufSize = la[13];  // 52

            // dlog('bigType: ' + bwg.type);
            // dlog('chromTree at: ' + bwg.chromTreeOffset);
            // dlog('uncompress: ' + bwg.uncompressBufSize);
            // dlog('data at: ' + bwg.unzoomedDataOffset);
            // dlog('index at: ' + bwg.unzoomedIndexOffset);
            // dlog('field count: ' + bwg.fieldCount);
            // dlog('defined count: ' + bwg.definedFieldCount);

            bwg.zoomLevels = [];
            for (var zl = 0; zl < bwg.numZoomLevels; ++zl) {
                var zlReduction = la[zl*6 + 16];
                var zlData = (la[zl*6 + 18]<<32)|(la[zl*6 + 19]);
                var zlIndex = (la[zl*6 + 20]<<32)|(la[zl*6 + 21]);
                //          dlog('zoom(' + zl + '): reduction=' + zlReduction + '; data=' + zlData + '; index=' + zlIndex);
                bwg.zoomLevels.push({reductionLevel: zlReduction, dataOffset: zlData, indexOffset: zlIndex});
            }

            // parse the totalSummary if present (summary of all data in the file)
            if( bwg.totalSummaryOffset ) {
                if( Float64Array ) {
                    (function() {
                        var ua = new Uint32Array( header, bwg.totalSummaryOffset, 2 );
                        var da = new Float64Array( header, bwg.totalSummaryOffset+8, 4 );
                        var s = {
                            basesCovered: ua[0]<<32 | ua[1],
                            scoreMin: da[0],
                            scoreMax: da[1],
                            scoreSum: da[2],
                            scoreSumSquares: da[3]
                        };
                        bwg._stats = s;
                        // rest of these will be calculated on demand in getGlobalStats
                    }).call();
                } else {
                    console.warn("BigWig "+bwg.data.url+ " total summary not available, this web browser is not capable of handling this data type.");
                }
            } else {
                    console.warn("BigWig "+bwg.data.url+ " has no total summary data.");
            }

            bwg._readChromTree(function() {
                bwg._loading.resolve({success: true});
            });
        },
        function( error ) { bwg._loading.resolve({success: false, error: error }); }
       );
    },

    loadSuccess: function() {},
    loadFail: function() {
    },

    readInt: function(ba, offset) {
        return (ba[offset + 3] << 24) | (ba[offset + 2] << 16) | (ba[offset + 1] << 8) | (ba[offset]);
    },

    readShort: function(ba, offset) {
        return (ba[offset + 1] << 8) | (ba[offset]);
    },

    /**
     * @private
     */
    _readChromTree: function(callback) {
        var thisB = this;
        this.chromsToIDs = {};
        this.idsToChroms = {};

        var udo = this.unzoomedDataOffset;
        while ((udo % 4) != 0) {
            ++udo;
        }

        var readInt   = this.readInt;
        var readShort = this.readShort;

        this.data.slice( this.chromTreeOffset, udo - this.chromTreeOffset )
            .fetch(function(bpt) {
                       if( !( Uint8Array && Int16Array && Int32Array ) ) {
                           var msg = 'Browser does not support typed arrays';
                           thisB._loading.resolve({success: false, error: msg});
                           return;
                       }
                       var ba = new Uint8Array(bpt);
                       var la = new Int32Array(bpt, 0, 6);
                       var bptMagic = la[0];
                       if( bptMagic !== 2026540177 )
                           throw "parse error: not a Kent bPlusTree";
                       var blockSize = la[1];
                       var keySize = la[2];
                       var valSize = la[3];
                       var itemCount = (la[4] << 32) | (la[5]);
                       var rootNodeOffset = 32;

                       //dlog('blockSize=' + blockSize + '    keySize=' + keySize + '   valSize=' + valSize + '    itemCount=' + itemCount);

                       var bptReadNode = function(offset) {
                           if( offset >= ba.length )
                               throw "reading beyond end of buffer";
                           var isLeafNode = ba[offset];
                           var cnt = readShort( ba, offset+2 );
                           //dlog('ReadNode: ' + offset + '     type=' + isLeafNode + '   count=' + cnt);
                           offset += 4;
                           for (var n = 0; n < cnt; ++n) {
                               if( isLeafNode ) {
                                   // parse leaf node
                                   var key = '';
                                   for (var ki = 0; ki < keySize; ++ki) {
                                       var charCode = ba[offset++];
                                       if (charCode != 0) {
                                           key += String.fromCharCode(charCode);
                                       }
                                   }
                                   var chromId = readInt( ba, offset );
                                   var chromSize = readInt( ba, offset+4 );
                                   offset += 8;

                                   //dlog(key + ':' + chromId + ',' + chromSize);
                                   thisB.chromsToIDs[key] = chromId;
                                   if (key.indexOf('chr') == 0) {
                                       thisB.chromsToIDs[key.substr(3)] = chromId;
                                   }
                                   thisB.idsToChroms[chromId] = key;
                               } else {
                                   // parse index node
                                   offset += keySize;
                                   var childOffset = (readInt( ba, offset+4 ) << 32) | readInt( ba, offset );
                                   offset += 8;
                                   childOffset -= thisB.chromTreeOffset;
                                   bptReadNode(childOffset);
                               }
                           }
                       };
                       bptReadNode(rootNodeOffset);

                       callback.call( thisB, thisB );
                   });
    },

    readWigData: function( basesPerSpan, chrName, min, max, callback) {
        var v = this.getView( basesPerSpan );
        if( !v ) {
            callback(null);
            return null;
        }
        return v.readWigData(chrName, min, max, callback);
    },

    iterate: function( start, end, featCallback, finishCallback ) {
        this.readWigData( 1, this.refSeq.name, start, end, function( features ) {
            if( features && features.length )
                array.forEach( features, featCallback );
            finishCallback();
        });
    },

    getUnzoomedView: function() {
        if (!this.unzoomedView) {
            var cirLen = 4000;
            var nzl = this.zoomLevels[0];
            if (nzl) {
                cirLen = this.zoomLevels[0].dataOffset - this.unzoomedIndexOffset;
            }
            this.unzoomedView = new Window( this, this.unzoomedIndexOffset, cirLen, false );
        }
        return this.unzoomedView;
    },

    getView: function( scale ) {
        if( ! this.zoomLevels || ! this.zoomLevels.length )
            return null;

        if( !this._viewCache || this._viewCache.scale != scale ) {
            this._viewCache = {
                scale: scale,
                view: this._getView( scale )
            };
        }
        return this._viewCache.view;
    },

    _getView: function( scale ) {
        var basesPerSpan = 1/scale;
        //console.log('getting view for '+basesPerSpan+' bases per span');
        for( var i = this.zoomLevels.length - 1; i > 0; i-- ) {
            var zh = this.zoomLevels[i];
            if( zh && zh.reductionLevel <= basesPerSpan ) {
                var indexLength = i < this.zoomLevels.length - 1
                    ? this.zoomLevels[i + 1].dataOffset - zh.indexOffset
                    : this.fileSize - 4 - zh.indexOffset;
                //console.log( 'using zoom level '+i);
                return new Window( this, zh.indexOffset, indexLength, true );
            }
        }
        //console.log( 'using unzoomed level');
        return this.getUnzoomedView();
    }
});

});