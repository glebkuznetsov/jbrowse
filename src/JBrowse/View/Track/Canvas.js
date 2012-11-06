define( ['dojo/_base/declare',
         'JBrowse/View/Track/BlockBased'
        ],
        function( declare,  BlockBased ) {
return declare( BlockBased,
/**
 * @lends JBrowse.View.Track.Canvas.prototype
 */
{
    /**
     * Base class for canvas-based JBrowse tracks.
     * @constructs
     */
    constructor: function( args ) {
        this.trackPadding = args.trackPadding || 0;

        if( ! ('style' in this.config ) ) {
            this.config.style = {};
        }
    },

    /**
     * Request that the track load its data.  The track will call its own
     * loadSuccess() function when it is loaded.
     */
    load: function() {
        this.loaded = true;
    },

    fillBlock: function( blockIndex,     block,
                         leftBlock,      rightBlock,
                         leftBase,       rightBase,
                         scale,          stripeWidth,
                         containerStart, containerEnd) {

        var blockWidth = rightBase - leftBase;
        this.heightUpdate( this.height, blockIndex );
        this.renderCanvases( scale, leftBase, rightBase, dojo.hitch(this, function( canvases ) {
            dojo.forEach( canvases, function(c) {
                              this.heightUpdate( c.height, blockIndex );
                              c.className = 'canvas-track';
	                      if (!(c.parentNode && c.parentNode.parentNode)) {
                                  c.style.position = "absolute";
                                  c.style.left = (100 * ((c.startBase - leftBase) / blockWidth)) + "%";
                                  switch (this.config.align) {
                                  case "top":
                                      c.style.top = "0px";
                                      break;
                                  case "bottom":
                                  default:
                                      c.style.bottom = this.trackPadding + "px";
                                      break;
                                  }
                                  block.appendChild(c);
	                      }
                          }, this);
        }));
    },

    startZoom: function(destScale, destStart, destEnd) {
        if (this.empty) return;
        this.preRenderCanvases( destScale, destStart, destEnd );
    },

    preRenderCanvases: function( scale, start, end ) {
    },

    endZoom: function(destScale, destBlockBases) {
        BlockBased.prototype.clear.apply(this);
    },

    clear: function() {
        BlockBased.prototype.clear.apply(this);
    },

    transfer: function(sourceBlock, destBlock, scale,
                       containerStart, containerEnd) {
        if (!(sourceBlock && destBlock)) return;

        var children = sourceBlock.childNodes;
        var destLeft = destBlock.startBase;
        var destRight = destBlock.endBase;
        var c;
        for (var i = 0; i < children.length; i++) {
	    c = children[i];
	    if ("startBase" in c) {
	        //if sourceBlock contains a canvas that overlaps destBlock,
	        if ((c.startBase < destRight)
		    && ((c.startBase + c.baseWidth) > destLeft)) {
		    //move canvas from sourceBlock to destBlock
		    c.style.left = (100 * ((c.startBase - destLeft) / (destRight - destLeft))) + "%";
		    destBlock.appendChild(c);
	        }
	    }
        }
    }
});
});
